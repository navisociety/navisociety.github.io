import { useState, useEffect, useRef, useCallback } from 'react';
import { navi, type NaviMessage } from './lib/navi-model';
import NaviMenu from './components/NaviMenu';
import NaviProfile from './components/NaviProfile';
import ChatsScreen from './components/ChatsScreen';
import NaviSubscribe from './components/NaviSubscribe';
import { supabase } from './lib/supabase';
import { callNaviPro, getSubscriptionStatus, saveMessage, createChatSession, renameChatSession, loadSessionMessages, sendMagicLink, type NaviSession, type ChatSession, } from './lib/navi-supabase';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
};

type Status = 'booting' | 'ready' | 'thinking';

// NAVI now lives on Supabase as an Edge Function (server-side inference).
// The function is public (no JWT required); we intentionally send no auth
// header — the Supabase gateway rejects the publishable key as an invalid JWT.
const NAVI_API = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/navi-chat`;

async function naviRespond(message: string, history: NaviMessage[]): Promise<string> {
  try {
    const res = await fetch(NAVI_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history }),
    });
    if (!res.ok) throw new Error(`NAVI API ${res.status}`);
    const data = await res.json();
    if (typeof data?.response === 'string' && data.response.trim()) return data.response;
    throw new Error('empty response');
  } catch {
    // Fallback: run NAVI client-side so the site never goes down.
    return navi.infer(message, history);
  }
}

const CYAN = '#00F7FF';
const MAGENTA = '#FA00FF';

export default function App() {
  const [status, setStatus] = useState<Status>('booting');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const [chatsOpen, setChatsOpen] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [mode, setMode] = useState<'free' | 'mini' | 'max'>('free');
  const [naviSession, setNaviSession] = useState<NaviSession | null>(null);
  const [showSubscribe, setShowSubscribe] = useState(false);
  const [subscribeMode, setSubscribeMode] = useState<'mini' | 'max'>('mini');
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  // Inline "save this chat" nudge — shown once the first user+NAVI exchange is
  // done and the user is not signed in. Auto-hides once a session exists.
  const [firstExchangeDone, setFirstExchangeDone] = useState(false);
  const [promptEmail, setPromptEmail] = useState('');
  const [promptSent, setPromptSent] = useState(false);
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptError, setPromptError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setStatus('ready');
      setMessages([{ id: '0', role: 'assistant', content: navi.getGreeting() }]);
      setTimeout(() => taRef.current?.focus(), 200);
    }, 1200);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Handle magic link redirect and persisted sessions via Supabase auth.
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session?.user?.email) {
        // Signed out (or no session): clear user-scoped state so the UI resets.
        setNaviSession(null);
        setMode('free');
        setCurrentSessionId(null);
        return;
      }
      const naviSess: NaviSession = { email: session.user.email, access_token: session.access_token };
      setNaviSession(naviSess);
      // Ensure profile exists for this user — handles pre-trigger users and first sign-ins
      supabase.from('profiles').upsert(
        { auth_id: session.user.id, email: session.user.email },
        { onConflict: 'auth_id', ignoreDuplicates: true }
      ).then(() => {});
      getSubscriptionStatus(naviSess.email).then(sub => {
        if (sub.active) setMode(sub.tier === 'max' ? 'max' : 'mini');
      });
    });
    return () => subscription.unsubscribe();
  }, []);

  async function handleAuth(session: NaviSession) {
    setNaviSession(session);
    setShowSubscribe(false);
    const sub = await getSubscriptionStatus(session.email);
    if (sub.active) setMode(sub.tier === 'max' ? 'max' : 'mini');
  }

  // Send a magic link from the inline "save this chat" nudge.
  const handlePromptSendLink = async () => {
    if (!promptEmail.trim()) return;
    setPromptLoading(true);
    setPromptError('');
    const { error: err } = await sendMagicLink(promptEmail.trim());
    setPromptLoading(false);
    if (err) { setPromptError(err || "Couldn't send sign-in email. Please try again."); return; }
    setPromptSent(true);
  };

  // Resume an existing chat session from ChatsScreen: load its full history
  // into the main view and point new messages at that same session_id so the
  // conversation continues seamlessly from where the user left off.
  const handleContinueSession = useCallback(async (s: ChatSession) => {
    if (!naviSession) return;
    setChatsOpen(false);
    setCurrentSessionId(s.id);
    setStatus('thinking');
    const past = await loadSessionMessages(naviSession.email, s.id);
    const loaded: Message[] = past.map(m => ({
      id: m.id,
      role: m.role,
      content: m.content,
    }));
    setMessages(loaded.length > 0
      ? loaded
      : [{ id: '0', role: 'assistant', content: navi.getGreeting() }]);
    setStatus('ready');
    setTimeout(() => taRef.current?.focus(), 120);
  }, [naviSession]);

  // Start a brand-new chat: clear the current session pointer and messages so
  // the next message opens a fresh session (created lazily in send()), then
  // drop the user back into the main view with NAVI's greeting.
  const handleNewChat = useCallback(() => {
    setChatsOpen(false);
    setCurrentSessionId(null);
    setMessages([{ id: '0', role: 'assistant', content: navi.getGreeting() }]);
    setStatus('ready');
    setTimeout(() => taRef.current?.focus(), 120);
  }, []);

  const stream = useCallback((text: string, msgId: string) => {
    if (timerRef.current) clearInterval(timerRef.current);
    let i = 0;
    timerRef.current = setInterval(() => {
      i += 5;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.id !== msgId) return prev;
        const done = i >= text.length;
        if (done && timerRef.current) {
          clearInterval(timerRef.current);
          setStatus('ready');
          // The first user+NAVI exchange is now complete — allow the nudge.
          setFirstExchangeDone(true);
          setTimeout(() => taRef.current?.focus(), 80);
        }
        return [...prev.slice(0, -1), { ...last, content: text.slice(0, i), streaming: !done }];
      });
    }, 14);
  }, []);

  function generateChatTitle(msg: string): string {
    const clean = msg.trim().replace(/\s+/g, ' ');
    if (clean.length <= 42) return clean;
    const cut = clean.substring(0, 42);
    const lastSpace = cut.lastIndexOf(' ');
    return (lastSpace > 15 ? cut.substring(0, lastSpace) : cut) + '…';
  }

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || status !== 'ready') return;

    const history: NaviMessage[] = messages
      .slice(-10)
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const userMsg: Message = { id: `u${Date.now()}`, role: 'user', content: text };
    const naviId = `n${Date.now()}`;
    const naviMsg: Message = { id: naviId, role: 'assistant', content: '', streaming: true };

    setMessages(prev => [...prev, userMsg, naviMsg]);
    setInput('');
    setStatus('thinking');

    const fullHistory = [...history, { role: 'user' as const, content: text }];

    // Mini/Max route to the server-side NAVI tiers; free stays on navi-chat.
    if ((mode === 'mini' || mode === 'max') && naviSession) {
      const endpoint = mode === 'mini' ? 'navi-mini' : 'navi-max';
      const result = await callNaviPro(endpoint, text, history, naviSession.email);
      if (result.response) {
        let sid = currentSessionId;
        if (!sid) {
          sid = await createChatSession(naviSession.email);
          if (sid) {
            setCurrentSessionId(sid);
            renameChatSession(sid, naviSession.email, generateChatTitle(text));
          }
        }
        saveMessage(naviSession.email, 'user', text, mode, sid ?? undefined);
        saveMessage(naviSession.email, 'assistant', result.response, mode, sid ?? undefined);
        stream(result.response, naviId);
        return;
      }
      if (result.code === 'no_subscription') {
        setSubscribeMode(mode);
        setMode('free');
        setShowSubscribe(true);
        stream(await naviRespond(text, fullHistory), naviId);
        return;
      }
      if (result.code === 'limit_reached') {
        stream("You've reached your monthly limit. Your compute resets next month.", naviId);
        return;
      }
      // Any other error → fall back to free NAVI.
      stream(await naviRespond(text, fullHistory), naviId);
      return;
    }

    // Free tier: ask NAVI on Supabase (falls back to client-side inference on failure).
    const response = await naviRespond(text, fullHistory);
    if (naviSession) {
      let sid = currentSessionId;
      if (!sid) {
        sid = await createChatSession(naviSession.email);
        if (sid) {
          setCurrentSessionId(sid);
          // Auto-title: rename from "New Chat" to first user message
          renameChatSession(sid, naviSession.email, generateChatTitle(text));
        }
      }
      saveMessage(naviSession.email, 'user', text, 'free', sid ?? undefined);
      saveMessage(naviSession.email, 'assistant', response, 'free', sid ?? undefined);
    }
    stream(response, naviId);
  }, [input, status, messages, stream, mode, naviSession, currentSessionId]);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  const handleMenuSelect = (item: string) => {
    setMenuOpen(false);
    if (item === 'Chats') setChatsOpen(true);
    if (item === 'Upgrade') { setSubscribeMode(mode === 'max' ? 'max' : 'mini'); setShowSubscribe(true); }
  };

  // The inline nudge appears only after the first exchange is done, while the
  // user is not signed in. onAuthStateChange clears naviSession on sign-out and
  // sets it on sign-in, so this hides automatically the moment a session exists.
  const showSignInPrompt = firstExchangeDone && !naviSession;

  if (status === 'booting') {
    return (
      <div style={{ minHeight: '100vh', background: '#000', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem', fontFamily: 'Fredoka, sans-serif' }}>
        <div style={{ animation: 'naviBob 2s ease-in-out infinite' }}>
          <img src="/navi.png" alt="NAVI" style={{ width: '200px', height: 'auto' }} />
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem' }}>
          {[0,1,2].map(i => (
            <div key={i} style={{ width: '0.4rem', height: '0.4rem', borderRadius: '9999px', background: '#00F7FF', animation: `naviBounce 1.2s ease-in-out ${i * 0.2}s infinite` }} />
          ))}
        </div>
        <style>{`
          @keyframes naviBounce { 0%,80%,100%{transform:scale(0.6);opacity:0.3} 40%{transform:scale(1.1);opacity:1} }
          @keyframes naviBob { 0%,100%{transform:translateY(0px)} 50%{transform:translateY(-10px)} }
          html,body,#root{background:#000;margin:0;padding:0;}
        `}</style>
      </div>
    );
  }

  return (
    <div style={{ minHeight: '100vh', background: '#000', display: 'flex', flexDirection: 'column', maxWidth: '480px', margin: '0 auto', fontFamily: 'Fredoka, sans-serif' }}>

      {/* ── Top bar ── */}
      <div style={{ display: 'flex', flexDirection: 'column', padding: '1.25rem 1.25rem 0', flexShrink: 0, gap: '0.6rem' }}>
        {/* Row 1: menu icon — top left */}
        <div>
          <button onClick={() => setMenuOpen(true)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
            <div style={{ width: '42px', height: '42px', background: '#00F7FF', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="22" height="16" viewBox="0 0 28 20" fill="none">
                <path d="M14 1C7.5 1 1.5 10 1.5 10S7.5 19 14 19 26.5 10 26.5 10 20.5 1 14 1z" stroke="#000" strokeWidth="1.8" fill="none"/>
                <circle cx="14" cy="10" r="4.5" fill="#000"/>
                <circle cx="12" cy="8" r="1.5" fill="white" opacity="0.5"/>
              </svg>
            </div>
          </button>
        </div>
        {/* Row 2: Mini (left) + Max (right) */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button onClick={() => { setSubscribeMode('mini'); setShowSubscribe(true); }} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', opacity: mode === 'mini' ? 1 : 0.45 }}>
            <span style={{ color: '#FA00FF', fontSize: '2rem', fontWeight: 700, fontFamily: 'Fredoka, sans-serif' }}>Mini</span>
          </button>
          <button onClick={() => { setSubscribeMode('max'); setShowSubscribe(true); }} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', opacity: mode === 'max' ? 1 : 0.45 }}>
            <span style={{ color: '#00F7FF', fontSize: '2rem', fontWeight: 700, fontFamily: 'Fredoka, sans-serif' }}>Max</span>
          </button>
        </div>
      </div>

      {/* ── Scrollable content ── */}
      <main style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 1rem 0.5rem' }}>

        {/* NAVI character */}
        <div style={{ marginTop: '0.25rem', marginBottom: '0.25rem', animation: 'naviBob 3s ease-in-out infinite', flexShrink: 0 }}>
          <img src="/navi.png" alt="NAVI" style={{ width: '240px', height: 'auto' }} />
        </div>

        {/* Messages */}
        <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
          {messages.map(msg => (
            <div key={msg.id} style={{ display: 'flex', gap: '0.5rem', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row', alignItems: 'flex-end' }}>
              {msg.role === 'assistant' && (
                <div style={{ width: '2rem', height: '2rem', borderRadius: '9999px', border: '1.5px solid #00F7FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <span style={{ color: '#00F7FF', fontSize: '0.68rem', fontWeight: 700 }}>N</span>
                </div>
              )}
              <div style={{
                maxWidth: '72%',
                padding: '0.65rem 0.95rem',
                borderRadius: msg.role === 'user' ? '1.1rem 1.1rem 0.2rem 1.1rem' : '1.1rem 1.1rem 1.1rem 0.2rem',
                background: '#00F7FF',
                color: '#000',
                fontSize: '0.95rem',
                lineHeight: '1.55',
                fontWeight: 500,
              }}>
                {msg.content}
                {msg.streaming && (
                  <span style={{ display: 'inline-block', width: '0.28rem', height: '0.85rem', background: '#000', marginLeft: '2px', verticalAlign: 'middle', borderRadius: '1px', animation: 'naviBlink 0.7s step-end infinite', opacity: 0.6 }} />
                )}
              </div>
            </div>
          ))}

          {/* Inline sign-in nudge — gentle, non-blocking. Sits below the chat
              messages, above the input bar. Hides automatically once signed in. */}
          {showSignInPrompt && (
            <div style={{
              marginTop: '0.5rem',
              background: '#0d0d0d',
              border: '1px solid #1a1a1a',
              borderRadius: '14px',
              padding: '0.95rem 1rem',
            }}>
              {!promptSent ? (
                <>
                  <div style={{ color: '#e8e8e8', fontSize: '0.92rem', lineHeight: 1.5, marginBottom: '0.7rem' }}>
                    Want to save this chat?{' '}
                    <span style={{ color: CYAN, fontWeight: 600 }}>Sign in with your email.</span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <input
                      type="email"
                      value={promptEmail}
                      onChange={(e) => setPromptEmail(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && handlePromptSendLink()}
                      placeholder="your@email.com"
                      style={{
                        flex: 1,
                        minWidth: 0,
                        background: '#111',
                        border: '1px solid #222',
                        borderRadius: '10px',
                        color: '#e8e8e8',
                        padding: '0.6rem 0.8rem',
                        fontFamily: 'Fredoka, sans-serif',
                        fontSize: '0.9rem',
                        outline: 'none',
                        boxSizing: 'border-box',
                      }}
                    />
                    <button
                      onClick={handlePromptSendLink}
                      disabled={promptLoading || !promptEmail.trim()}
                      style={{
                        flexShrink: 0,
                        background: CYAN,
                        color: '#000',
                        border: 'none',
                        borderRadius: '10px',
                        padding: '0.6rem 1rem',
                        fontFamily: 'Fredoka, sans-serif',
                        fontSize: '0.9rem',
                        fontWeight: 700,
                        cursor: promptLoading || !promptEmail.trim() ? 'not-allowed' : 'pointer',
                        opacity: promptLoading || !promptEmail.trim() ? 0.6 : 1,
                        transition: 'opacity 0.15s',
                      }}
                    >
                      {promptLoading ? '…' : 'Sign In'}
                    </button>
                  </div>
                  {promptError && (
                    <div style={{ color: MAGENTA, fontSize: '0.82rem', marginTop: '0.55rem' }}>{promptError}</div>
                  )}
                </>
              ) : (
                <div style={{ color: CYAN, fontSize: '0.95rem', fontWeight: 600, lineHeight: 1.5 }}>
                  Check your inbox!
                  <div style={{ color: '#888', fontSize: '0.82rem', fontWeight: 400, marginTop: '0.3rem' }}>
                    We sent a sign-in link to {promptEmail}.
                  </div>
                </div>
              )}
            </div>
          )}

          <div ref={bottomRef} />
        </div>
      </main>

      {/* ── Input bar ── */}
      <footer style={{ padding: '0.6rem 1rem 1.5rem', background: '#000', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', background: '#111', border: '1px solid #222', borderRadius: '2rem', padding: '0.55rem 0.55rem 0.55rem 1.1rem' }}>
          <textarea
            ref={taRef}
            value={input}
            onChange={e => {
              setInput(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
            }}
            onKeyDown={onKey}
            placeholder={status === 'ready' ? 'Talk to NAVI' : 'NAVI is thinking...'}
            disabled={status !== 'ready'}
            rows={1}
            style={{ flex: 1, background: 'transparent', color: '#e8e8e8', border: 'none', outline: 'none', resize: 'none', fontFamily: 'Fredoka, sans-serif', fontSize: '1rem', lineHeight: 1.5, minHeight: '24px' }}
          />
          <button
            onClick={send}
            disabled={status !== 'ready' || !input.trim()}
            style={{
              width: '2.4rem', height: '2.4rem', borderRadius: '9999px', border: 'none', flexShrink: 0,
              cursor: input.trim() && status === 'ready' ? 'pointer' : 'not-allowed',
              background: input.trim() && status === 'ready' ? '#00F7FF' : '#2a2a2a',
              opacity: input.trim() && status === 'ready' ? 1 : 0.5,
              boxShadow: input.trim() && status === 'ready' ? '0 0 12px #00F7FF44' : 'none',
              transition: 'all 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
              <path d="M1 7h12M7.5 1.5L13 7l-5.5 5.5" stroke={input.trim() && status === 'ready' ? '#000' : '#555'} strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
      </footer>

      <style>{`
        @keyframes naviBlink { 0%,100%{opacity:0.6} 50%{opacity:0} }
        @keyframes naviBob { 0%,100%{transform:translateY(0px)} 50%{transform:translateY(-8px)} }
        html,body,#root { background:#000; margin:0; padding:0; }
        ::-webkit-scrollbar { width:3px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:rgba(0,247,255,0.15); border-radius:2px; }
        textarea::placeholder { color:#555; }
      `}</style>

      {menuOpen && <NaviMenu onClose={() => setMenuOpen(false)} onSelect={handleMenuSelect} mode={mode} email={naviSession?.email ?? null} onProfileOpen={() => { setMenuOpen(false); setShowProfile(true); }} />}
      {showProfile && <NaviProfile session={naviSession} onClose={() => setShowProfile(false)} />}
      {chatsOpen && <ChatsScreen onClose={() => setChatsOpen(false)} session={naviSession} onAuth={handleAuth} onContinueSession={handleContinueSession} onNewChat={handleNewChat} />}
      {showSubscribe && <NaviSubscribe mode={subscribeMode} session={naviSession} onAuthenticated={handleAuth} onClose={() => setShowSubscribe(false)} />}
    </div>
  );
}
