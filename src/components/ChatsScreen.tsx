import { FC, useState, useEffect } from 'react';
import { sendMagicLink, loadChatHistory, NaviSession, ChatMessage } from '../lib/navi-supabase';

interface Props {
  onClose: () => void;
  session: NaviSession | null;
  onAuth: (session: NaviSession) => void;
}

const ChatsScreen: FC<Props> = ({ onClose, session, onAuth }) => {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<ChatMessage[]>([]);
  const [fetching, setFetching] = useState(false);

  useEffect(() => {
    if (!session) return;
    setFetching(true);
    loadChatHistory(session.email).then(msgs => {
      setHistory(msgs);
      setFetching(false);
    });
  }, [session]);

  async function handleSendLink() {
    if (!email.trim()) return;
    setLoading(true);
    setError('');
    const { error: err } = await sendMagicLink(email.trim());
    setLoading(false);
    if (err) { setError(err); return; }
    setSent(true);
  }

  function formatDate(iso: string) {
    return new Date(iso).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function groupByDate(msgs: ChatMessage[]) {
    const groups: { date: string; messages: ChatMessage[] }[] = [];
    let last = '';
    for (const msg of msgs) {
      const d = formatDate(msg.created_at);
      if (d !== last) { groups.push({ date: d, messages: [] }); last = d; }
      groups[groups.length - 1].messages.push(msg);
    }
    return groups;
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 999, display: 'flex', flexDirection: 'column', fontFamily: 'Fredoka, sans-serif' }}>

      {/* Back */}
      <div style={{ padding: '1.25rem 1.25rem 0', maxWidth: '480px', margin: '0 auto', width: '100%', boxSizing: 'border-box', flexShrink: 0 }}>
        <button onClick={onClose} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <div style={{ width: '42px', height: '42px', background: '#00F7FF', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
              <path d="M17 7H1M7 1L1 7l6 6" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </button>
      </div>

      {!session ? (
        /* ── Sign-in state ── */
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', maxWidth: '480px', margin: '0 auto', width: '100%', padding: '0 2rem', boxSizing: 'border-box', gap: '1.2rem' }}>
          {!sent ? (
            <>
              <div style={{ textAlign: 'center' }}>
                <div style={{ color: '#fff', fontSize: '1.8rem', fontWeight: 700 }}>Your Chats</div>
                <div style={{ color: '#444', fontSize: '0.95rem', marginTop: '8px', lineHeight: 1.6 }}>
                  Enter your email to access your past conversations.
                </div>
              </div>
              <input
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={e => setEmail(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleSendLink()}
                style={{ background: '#111', border: '1.5px solid #333', borderRadius: '10px', color: '#fff', padding: '12px 16px', fontSize: '15px', fontFamily: 'Fredoka, sans-serif', outline: 'none', width: '100%', boxSizing: 'border-box' }}
              />
              {error && <div style={{ color: '#ff4444', fontSize: '13px' }}>{error}</div>}
              <button
                onClick={handleSendLink}
                disabled={loading || !email.trim()}
                style={{ background: '#00F7FF', color: '#000', border: 'none', borderRadius: '10px', padding: '13px', fontSize: '16px', fontWeight: 700, fontFamily: 'Fredoka, sans-serif', cursor: loading ? 'wait' : 'pointer', opacity: loading || !email.trim() ? 0.6 : 1, width: '100%' }}
              >
                {loading ? 'Sending...' : 'Sign In'}
              </button>
            </>
          ) : (
            <>
              <div style={{ color: '#00F7FF', fontSize: '1.6rem', fontWeight: 700, textAlign: 'center' }}>Check your email</div>
              <div style={{ color: '#555', fontSize: '0.95rem', textAlign: 'center', lineHeight: 1.7 }}>
                We sent a link to <span style={{ color: '#aaa' }}>{email}</span>.<br />
                Click it to sign in and see your chats.
              </div>
            </>
          )}
        </div>
      ) : (
        /* ── Chat history ── */
        <div style={{ flex: 1, overflowY: 'auto', maxWidth: '480px', margin: '0 auto', width: '100%', padding: '1rem 1rem 2rem', boxSizing: 'border-box' }}>
          <div style={{ color: '#fff', fontSize: '1.8rem', fontWeight: 700, marginBottom: '1.2rem', paddingLeft: '0.25rem' }}>Your Chats</div>

          {fetching && (
            <div style={{ color: '#2a2a2a', textAlign: 'center', paddingTop: '3rem', fontSize: '0.9rem' }}>Loading...</div>
          )}

          {!fetching && history.length === 0 && (
            <div style={{ color: '#2a2a2a', textAlign: 'center', paddingTop: '3rem', fontSize: '0.95rem' }}>
              No conversations yet. Start chatting with NAVI.
            </div>
          )}

          {!fetching && groupByDate(history).map(group => (
            <div key={group.date}>
              <div style={{ color: '#222', fontSize: '11px', textAlign: 'center', margin: '1.4rem 0 0.8rem', letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                {group.date}
              </div>
              {group.messages.map(msg => (
                <div key={msg.id} style={{ display: 'flex', gap: '0.5rem', flexDirection: msg.role === 'user' ? 'row-reverse' : 'row', alignItems: 'flex-end', marginBottom: '0.65rem' }}>
                  {msg.role === 'assistant' && (
                    <div style={{ width: '1.8rem', height: '1.8rem', borderRadius: '9999px', border: '1.5px solid #00F7FF', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span style={{ color: '#00F7FF', fontSize: '0.6rem', fontWeight: 700 }}>N</span>
                    </div>
                  )}
                  <div style={{ maxWidth: '72%', padding: '0.6rem 0.9rem', borderRadius: msg.role === 'user' ? '1rem 1rem 0.2rem 1rem' : '1rem 1rem 1rem 0.2rem', background: '#00F7FF', color: '#000', fontSize: '0.9rem', lineHeight: 1.5, fontWeight: 500 }}>
                    {msg.content}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};

export default ChatsScreen;