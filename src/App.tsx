import { useState, useEffect, useRef, useCallback } from 'react';
import { navi, type NaviMessage } from './lib/navi-model';

type Message = {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  streaming?: boolean;
};

type Status = 'booting' | 'ready' | 'thinking';

export default function App() {
  const [status, setStatus] = useState<Status>('booting');
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Boot: initialise NAVI model (pre-computes knowledge embeddings)
  useEffect(() => {
    // navi singleton initialises synchronously on import
    // Give a brief boot animation then show greeting
    const t = setTimeout(() => {
      setStatus('ready');
      setMessages([{ id: '0', role: 'assistant', content: "I'm NAVI. What's on your mind?" }]);
      setTimeout(() => taRef.current?.focus(), 200);
    }, 1200);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Typewriter streaming effect
  const stream = useCallback((text: string, msgId: string) => {
    if (timerRef.current) clearInterval(timerRef.current);
    let i = 0;
    timerRef.current = setInterval(() => {
      i += 5;
      setMessages(prev => {
        const last = prev[prev.length - 1];
        if (last?.id !== msgId) return prev;
        const done = i >= text.length;
        if (done && timerRef.current) { clearInterval(timerRef.current); setStatus('ready'); setTimeout(() => taRef.current?.focus(), 80); }
        return [...prev.slice(0, -1), { ...last, content: text.slice(0, i), streaming: !done }];
      });
    }, 14);
  }, []);

  const send = useCallback(() => {
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

    // Run NAVI inference (synchronous, fast)
    const response = navi.infer(text, [...history, { role: 'user', content: text }]);

    // Brief thinking delay for UX, then stream the response
    setTimeout(() => stream(response, naviId), 280);
  }, [input, status, messages, stream]);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

  // ── Boot screen ─────────────────────────────────────────────────────────────
  if (status === 'booting') {
    return (
      <div style={{ minHeight: '100vh', background: '#000', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '2rem', padding: '1.5rem', fontFamily: 'Fredoka, sans-serif' }}>
        <div style={{ width: '6rem', height: '6rem', borderRadius: '9999px', border: '2px solid #00F7FF', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 40px #00F7FF30, 0 0 80px #00F7FF14' }}>
          <span style={{ color: '#00F7FF', fontSize: '2.5rem', fontWeight: 700 }}>N</span>
        </div>
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ color: '#00F7FF', fontSize: '3.5rem', fontWeight: 700, letterSpacing: '0.2em', margin: 0 }}>NAVI</h1>
          <p style={{ color: '#3f3f46', fontSize: '0.8rem', letterSpacing: '0.35em', marginTop: '0.3rem' }}>NAVISOCIETY</p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{ width: '0.4rem', height: '0.4rem', borderRadius: '9999px', background: '#00F7FF', animation: `naviBounce 1.2s ease-in-out ${i * 0.2}s infinite` }} />
          ))}
        </div>
        <style>{`@keyframes naviBounce { 0%,80%,100%{transform:scale(0.6);opacity:0.3} 40%{transform:scale(1.1);opacity:1} }`}</style>
      </div>
    );
  }

  // ── Chat screen ─────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: '#000', display: 'flex', flexDirection: 'column', maxWidth: '700px', margin: '0 auto', fontFamily: 'Fredoka, sans-serif' }}>

      {/* Header */}
      <header style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', padding: '0.75rem 1rem', borderBottom: '1px solid #18181b', position: 'sticky', top: 0, background: '#000', zIndex: 10 }}>
        <div style={{ width: '2.25rem', height: '2.25rem', borderRadius: '9999px', border: '1px solid #00F7FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 0 10px #00F7FF28' }}>
          <span style={{ color: '#00F7FF', fontSize: '0.75rem', fontWeight: 700 }}>N</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <span style={{ color: '#00F7FF', fontSize: '1.2rem', fontWeight: 700 }}>NAVI</span>
          <span style={{ background: '#00F7FF', color: '#000', fontSize: '0.55rem', fontWeight: 700, padding: '2px 7px', borderRadius: '9999px', letterSpacing: '0.05em' }}>FREE LLM</span>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
          <div style={{ width: '0.4rem', height: '0.4rem', borderRadius: '9999px', background: status === 'ready' ? '#00F7FF' : '#facc15', boxShadow: status === 'ready' ? '0 0 6px #00F7FF' : '0 0 6px #facc15', transition: 'background 0.3s' }} />
          <span style={{ color: '#52525b', fontSize: '0.65rem' }}>{status === 'ready' ? 'online' : 'thinking...'}</span>
        </div>
      </header>

      {/* Messages */}
      <main style={{ flex: 1, overflowY: 'auto', padding: '1.5rem 1rem', display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
        {messages.map(msg => (
          <div key={msg.id} style={{ display: 'flex', gap: '0.6rem', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row', alignItems: 'flex-start' }}>
            {msg.role === 'assistant' && (
              <div style={{ width: '1.75rem', height: '1.75rem', borderRadius: '9999px', border: '1px solid #00F7FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: '2px', boxShadow: '0 0 6px #00F7FF20' }}>
                <span style={{ color: '#00F7FF', fontSize: '0.6rem', fontWeight: 700 }}>N</span>
              </div>
            )}
            <div style={{
              maxWidth: '78%', padding: '0.7rem 1rem', fontSize: '0.92rem', lineHeight: '1.6', whiteSpace: 'pre-wrap',
              borderRadius: msg.role === 'user' ? '1rem 1rem 0.2rem 1rem' : '1rem 1rem 1rem 0.2rem',
              background: msg.role === 'user' ? '#18181b' : 'rgba(0,247,255,0.025)',
              border: msg.role === 'user' ? '1px solid #27272a' : '1px solid #0c1f20',
              color: msg.role === 'user' ? '#f4f4f5' : '#d4d4d8',
            }}>
              {msg.content}
              {msg.streaming && (
                <span style={{ display: 'inline-block', width: '0.32rem', height: '0.85rem', background: '#00F7FF', marginLeft: '2px', verticalAlign: 'middle', borderRadius: '1px', animation: 'naviBlink 0.7s step-end infinite' }} />
              )}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </main>

      {/* Input */}
      <footer style={{ padding: '0.75rem 1rem 1.25rem', borderTop: '1px solid #18181b', position: 'sticky', bottom: 0, background: '#000' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.5rem', border: '1px solid #27272a', borderRadius: '1.25rem', padding: '0.7rem 0.9rem', transition: 'border-color 0.2s' }}
          onFocus={e => (e.currentTarget.style.borderColor = '#2a3a3b')}
          onBlur={e => (e.currentTarget.style.borderColor = '#27272a')}
        >
          <textarea
            ref={taRef}
            value={input}
            onChange={e => {
              setInput(e.target.value);
              e.target.style.height = 'auto';
              e.target.style.height = Math.min(e.target.scrollHeight, 128) + 'px';
            }}
            onKeyDown={onKey}
            placeholder={status === 'ready' ? 'Message NAVI...' : 'NAVI is thinking...'}
            disabled={status !== 'ready'}
            rows={1}
            style={{ flex: 1, background: 'transparent', color: '#f4f4f5', border: 'none', outline: 'none', resize: 'none', fontFamily: 'Fredoka, sans-serif', fontSize: '0.9rem', lineHeight: 1.5, minHeight: '22px' }}
          />
          <button
            onClick={send}
            disabled={status !== 'ready' || !input.trim()}
            style={{
              width: '2rem', height: '2rem', borderRadius: '9999px', border: 'none', flexShrink: 0,
              cursor: input.trim() && status === 'ready' ? 'pointer' : 'not-allowed',
              background: input.trim() && status === 'ready' ? '#00F7FF' : '#27272a',
              boxShadow: input.trim() && status === 'ready' ? '0 0 14px #00F7FF50' : 'none',
              opacity: status !== 'ready' || !input.trim() ? 0.35 : 1,
              transition: 'all 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}
          >
            <svg width="13" height="13" viewBox="0 0 14 14" fill="none">
              <path d="M1 7h12M7.5 1.5L13 7l-5.5 5.5" stroke={input.trim() && status === 'ready' ? '#000' : '#71717a'} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        </div>
        <p style={{ textAlign: 'center', color: '#27272a', fontSize: '0.58rem', marginTop: '0.5rem' }}>
          NAVI LLM v1.0 · NAVIsociety · Built by Prophet Dian · Free forever
        </p>
      </footer>

      <style>{`
        @keyframes naviBlink { 0%,100%{opacity:1} 50%{opacity:0} }
        html,body,#root { background:#000; margin:0; padding:0; }
        ::-webkit-scrollbar { width:3px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:rgba(0,247,255,0.12); border-radius:2px; }
      `}</style>
    </div>
  );
}
