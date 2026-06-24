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

  useEffect(() => {
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
          setTimeout(() => taRef.current?.focus(), 80);
        }
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

    const response = navi.infer(text, [...history, { role: 'user', content: text }]);
    setTimeout(() => stream(response, naviId), 280);
  }, [input, status, messages, stream]);

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  };

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

      {/* ── Top bar: Mini + Max ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '1.25rem 1.25rem 0', flexShrink: 0 }}>
        <button style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <span style={{ color: '#FA00FF', fontSize: '2rem', fontWeight: 700, fontFamily: 'Fredoka, sans-serif' }}>Mini</span>
        </button>
        <button style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.2rem' }}>
          <div style={{ width: '54px', height: '54px', background: '#00F7FF', borderRadius: '12px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="28" height="20" viewBox="0 0 28 20" fill="none">
              <path d="M14 1C7.5 1 1.5 10 1.5 10S7.5 19 14 19 26.5 10 26.5 10 20.5 1 14 1z" stroke="#000" strokeWidth="1.8" fill="none"/>
              <circle cx="14" cy="10" r="4.5" fill="#000"/>
              <circle cx="12" cy="8" r="1.5" fill="white" opacity="0.5"/>
            </svg>
          </div>
          <span style={{ color: '#00F7FF', fontSize: '2rem', fontWeight: 700, fontFamily: 'Fredoka, sans-serif' }}>Max</span>
        </button>
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
    </div>
  );
}
