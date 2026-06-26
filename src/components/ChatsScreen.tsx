import { FC, useState, useEffect } from 'react';
import { sendMagicLink, loadChatSessions, loadSessionMessages, deleteChatSession, NaviSession, ChatSession, ChatMessage } from '../lib/navi-supabase';

interface Props {
  onClose: () => void;
  session: NaviSession | null;
  onAuth: (session: NaviSession) => void;
  onContinueSession?: (s: ChatSession) => void;
  onNewChat?: () => void;
}

const CYAN = '#00F7FF';

const ChatsScreen: FC<Props> = ({ onClose, session, onContinueSession, onNewChat }) => {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [linkLoading, setLinkLoading] = useState(false);
  const [linkError, setLinkError] = useState('');

  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [fetching, setFetching] = useState(false);
  const [activeSession, setActiveSession] = useState<ChatSession | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [msgFetching, setMsgFetching] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    if (!session) return;
    setFetching(true);
    loadChatSessions(session.email).then(data => {
      setSessions(data);
      setFetching(false);
    });
  }, [session]);

  function openSession(s: ChatSession) {
    setActiveSession(s);
    setMsgFetching(true);
    loadSessionMessages(session!.email, s.id).then(msgs => {
      setMessages(msgs);
      setMsgFetching(false);
    });
  }

  async function handleDelete(e: React.MouseEvent, s: ChatSession) {
    e.stopPropagation();
    setDeleting(s.id);
    await deleteChatSession(s.id, session!.email);
    setSessions(prev => prev.filter(x => x.id !== s.id));
    setDeleting(null);
  }

  async function handleSendLink() {
    if (!email.trim()) return;
    setLinkLoading(true);
    setLinkError('');
    const { error: err } = await sendMagicLink(email.trim());
    setLinkLoading(false);
    if (err) { setLinkError(err || "Couldn't send sign-in email. Please try again."); return; }
    setSent(true);
  }

  function formatDate(iso: string) {
    const d = new Date(iso);
    const now = new Date();
    const diff = now.getTime() - d.getTime();
    if (diff < 86400000) return d.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' });
    if (diff < 604800000) return d.toLocaleDateString('en-ZA', { weekday: 'short' });
    return d.toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' });
  }

  const backBtn = (onClick: () => void) => (
    <div style={{ padding: '1.25rem 1.25rem 0', maxWidth: '480px', margin: '0 auto', width: '100%', boxSizing: 'border-box' as const, flexShrink: 0 }}>
      <button onClick={onClick} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
        <div style={{ width: '42px', height: '42px', background: CYAN, borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
            <path d="M17 7H1M7 1L1 7l6 6" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </button>
    </div>
  );

  // ── Sign-in state ────────────────────────────────────────────────────
  if (!session) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 999, display: 'flex', flexDirection: 'column', fontFamily: 'Fredoka, sans-serif' }}>
        {backBtn(onClose)}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', maxWidth: '480px', margin: '0 auto', width: '100%', padding: '0 2rem', boxSizing: 'border-box' as const, gap: '1.2rem' }}>
          {!sent ? (
            <>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: '#fff', fontSize: '1.8rem', fontWeight: 700 }}>Your Chats</div>
                <div style={{ color: '#555', fontSize: '0.95rem', marginTop: '8px', lineHeight: 1.6 }}>Enter your email to access your conversations.</div>
              </div>
              <input type="email" placeholder="your@email.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSendLink()}
                style={{ background: '#111', border: '1.5px solid #333', borderRadius: '10px', color: '#fff', padding: '12px 16px', fontSize: '15px', fontFamily: 'Fredoka, sans-serif', outline: 'none', width: '100%', boxSizing: 'border-box' as const }} />
              {linkError && <div style={{ color: '#ff4444', fontSize: '13px' }}>{linkError}</div>}
              <button onClick={handleSendLink} disabled={linkLoading || !email.trim()}
                style={{ background: CYAN, color: '#000', border: 'none', borderRadius: '10px', padding: '13px', fontSize: '16px', fontWeight: 700, fontFamily: 'Fredoka, sans-serif', cursor: linkLoading ? 'wait' : 'pointer', opacity: linkLoading || !email.trim() ? 0.6 : 1, width: '100%' }}>
                {linkLoading ? 'Sending...' : 'Sign In'}
              </button>
            </>
          ) : (
            <>
              <div style={{ color: CYAN, fontSize: '1.6rem', fontWeight: 700, textAlign: 'center' }}>Check your email</div>
              <div style={{ color: '#555', fontSize: '0.95rem', textAlign: 'center', lineHeight: 1.7 }}>
                We sent a link to <span style={{ color: '#aaa' }}>{email}</span>.<br/>Click it to sign in and see your chats.
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ── Session message view ─────────────────────────────────────────────
  if (activeSession) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 999, display: 'flex', flexDirection: 'column', fontFamily: 'Fredoka, sans-serif' }}>
        {backBtn(() => { setActiveSession(null); setMessages([]); })}
        <div style={{ maxWidth: '480px', margin: '0 auto', width: '100%', padding: '1rem 1.25rem 0.5rem', boxSizing: 'border-box' as const, flexShrink: 0 }}>
          <div style={{ color: '#fff', fontSize: '1.4rem', fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{activeSession.title}</div>
        </div>
        <div style={{ flex: 1, overflowY: 'auto', maxWidth: '480px', margin: '0 auto', width: '100%', padding: '0.5rem 1rem 2rem', boxSizing: 'border-box' as const }}>
          {msgFetching && <div style={{ color: '#555', textAlign: 'center', paddingTop: '2rem', fontSize: '0.9rem' }}>Loading…</div>}
          {!msgFetching && messages.length === 0 && <div style={{ color: '#555', textAlign: 'center', paddingTop: '2rem', fontSize: '0.95rem' }}>No messages in this chat.</div>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
            {messages.map(msg => (
              <div key={msg.id} style={{ display: 'flex', gap: '0.5rem', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row', alignItems: 'flex-end' }}>
                {msg.role === 'assistant' && (
                  <div style={{ width: '2rem', height: '2rem', borderRadius: '9999px', border: `1.5px solid ${CYAN}`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <span style={{ color: CYAN, fontSize: '0.68rem', fontWeight: 700 }}>N</span>
                  </div>
                )}
                <div style={{ maxWidth: '72%', padding: '0.65rem 0.95rem', borderRadius: msg.role === 'user' ? '1.1rem 1.1rem 0.2rem 1.1rem' : '1.1rem 1.1rem 1.1rem 0.2rem', background: CYAN, color: '#000', fontSize: '0.9rem', lineHeight: 1.55, fontWeight: 500 }}>
                  {msg.content}
                </div>
              </div>
            ))}
          </div>
        </div>
        {/* Continue this chat — lifts the session back into the main view so the user keeps talking to NAVI from here. New messages append to this same session_id. */}
        {onContinueSession && (
          <div style={{ flexShrink: 0, maxWidth: '480px', margin: '0 auto', width: '100%', padding: '0.5rem 1.25rem 1.5rem', boxSizing: 'border-box' as const }}>
            <button
              onClick={() => onContinueSession(activeSession)}
              style={{ width: '100%', background: CYAN, color: '#000', border: 'none', borderRadius: '12px', padding: '0.9rem', fontFamily: 'Fredoka, sans-serif', fontSize: '1.05rem', fontWeight: 700, cursor: 'pointer' }}
            >
              Continue this chat
            </button>
          </div>
        )}
      </div>
    );
  }

  // ── Session list view ────────────────────────────────────────────────
  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 999, display: 'flex', flexDirection: 'column', fontFamily: 'Fredoka, sans-serif' }}>
      {backBtn(onClose)}
      <div style={{ flex: 1, overflowY: 'auto', maxWidth: '480px', margin: '0 auto', width: '100%', padding: '1rem 1.25rem 2rem', boxSizing: 'border-box' as const }}>
        <div style={{ color: '#fff', fontSize: '2rem', fontWeight: 700, marginBottom: '1.25rem' }}>Chats</div>

        {/* New Chat — clears the current conversation and starts a fresh blank
            session, then drops the user back into the main view to talk to NAVI. */}
        {onNewChat && (
          <button
            onClick={onNewChat}
            style={{ width: '100%', background: CYAN, color: '#000', border: 'none', borderRadius: '12px', padding: '0.9rem', fontFamily: 'Fredoka, sans-serif', fontSize: '1.05rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', marginBottom: '1.25rem', boxShadow: '0 0 14px #00F7FF33' }}
          >
            <span style={{ fontSize: '1.35rem', lineHeight: 1, marginTop: '-2px' }}>+</span>
            New Chat
          </button>
        )}

        {fetching && <div style={{ color: '#555', fontSize: '0.9rem', textAlign: 'center', paddingTop: '2rem' }}>Loading…</div>}

        {!fetching && sessions.length === 0 && (
          <div style={{ color: '#555', fontSize: '0.95rem', textAlign: 'center', paddingTop: '2rem', lineHeight: 1.7 }}>
            No chats yet.<br/>Start a conversation with NAVI.
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          {sessions.map(s => (
            <div key={s.id} onClick={() => openSession(s)}
              style={{ background: '#0d0d0d', border: '1px solid #1a1a1a', borderRadius: '12px', padding: '0.9rem 1rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.75rem', transition: 'border-color 0.15s' }}
              onMouseEnter={e => (e.currentTarget.style.borderColor = '#333')}
              onMouseLeave={e => (e.currentTarget.style.borderColor = '#1a1a1a')}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem', marginBottom: '0.3rem' }}>
                  <span style={{ color: '#fff', fontWeight: 700, fontSize: '1rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, flex: 1 }}>{s.title}</span>
                  <span style={{ color: '#444', fontSize: '0.78rem', flexShrink: 0 }}>{formatDate(s.updated_at)}</span>
                </div>
                {s.last_message && (
                  <div style={{ color: '#444', fontSize: '0.85rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>{s.last_message}</div>
                )}
              </div>
              <button
                onClick={e => handleDelete(e, s)}
                disabled={deleting === s.id}
                style={{ background: 'none', border: 'none', color: '#333', fontSize: '1.1rem', cursor: 'pointer', padding: '0.25rem 0.4rem', borderRadius: '6px', flexShrink: 0, transition: 'color 0.15s', lineHeight: 1 }}
                onMouseEnter={e => (e.currentTarget.style.color = '#ff4444')}
                onMouseLeave={e => (e.currentTarget.style.color = '#333')}
                title="Delete chat"
              >
                {deleting === s.id ? '…' : '✕'}
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default ChatsScreen;
