import { FC, useState, useEffect, useCallback } from 'react';

interface Props {
  userEmail: string;
  onBack: () => void;
}

type View = 'list' | 'compose' | 'read-message' | 'read-stored' | 'edit-draft';
type Tab = 'inbox' | 'sent' | 'drafts';

interface InboxItem {
  id: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  snippet: string;
}

interface StoredEmail {
  id: string;
  recipient: string;
  subject: string;
  body: string;
  status: 'draft' | 'sent';
  sent_at: string | null;
  created_at: string;
}

interface FullMessage {
  id: string;
  subject: string;
  from: string;
  to: string;
  date: string;
  body: string;
}

const API = 'https://irssegzkvxyewuxgqpwi.supabase.co/functions/v1/navi-email';

async function emailApi(body: Record<string, unknown>) {
  const res = await fetch(API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
  return data;
}

const CYAN = '#00F7FF';
const MAG = '#FA00FF';
const RED = '#FA0000';

const BackBtn: FC<{ onClick: () => void }> = ({ onClick }) => (
  <button onClick={onClick} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0 }}>
    <div style={{ width: 42, height: 42, background: CYAN, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
        <path d="M17 7H1M7 1L1 7l6 6" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  </button>
);

const inputStyle: React.CSSProperties = {
  background: '#111', border: '1px solid #222', color: '#fff',
  borderRadius: 10, padding: '0.75rem', fontFamily: 'Fredoka, sans-serif',
  fontSize: '1rem', width: '100%', boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  color: '#555', fontSize: '0.8rem', marginBottom: 4, display: 'block',
};

const btnCyan: React.CSSProperties = {
  background: CYAN, color: '#000', border: 'none', borderRadius: 10,
  fontFamily: 'Fredoka, sans-serif', fontWeight: 700, fontSize: '1rem',
  padding: '0.65rem 1.2rem', cursor: 'pointer',
};

const btnMag: React.CSSProperties = {
  background: 'none', color: MAG, border: `2px solid ${MAG}`, borderRadius: 10,
  fontFamily: 'Fredoka, sans-serif', fontWeight: 700, fontSize: '1rem',
  padding: '0.65rem 1.2rem', cursor: 'pointer',
};

const EmailScreen: FC<Props> = ({ userEmail, onBack }) => {
  const [view, setView] = useState<View>('list');
  const [tab, setTab] = useState<Tab>('inbox');
  const [connected, setConnected] = useState<boolean | null>(null);
  const [gmailAddress, setGmailAddress] = useState<string | null>(null);
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [sent, setSent] = useState<StoredEmail[]>([]);
  const [drafts, setDrafts] = useState<StoredEmail[]>([]);
  const [selectedMsg, setSelectedMsg] = useState<FullMessage | null>(null);
  const [selectedStored, setSelectedStored] = useState<StoredEmail | null>(null);
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [composeBody, setComposeBody] = useState('');
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [error, setError] = useState('');
  const [sendStatus, setSendStatus] = useState<'' | 'sending' | 'sent' | 'error'>('');

  const loadInbox = useCallback(async () => {
    setListLoading(true);
    try {
      const d = await emailApi({ action: 'list-inbox', email: userEmail });
      setInbox(d.messages ?? []);
    } catch { /* silent */ } finally { setListLoading(false); }
  }, [userEmail]);

  const loadSent = useCallback(async () => {
    setListLoading(true);
    try {
      const d = await emailApi({ action: 'list-sent', email: userEmail });
      setSent(d.emails ?? []);
    } catch { /* silent */ } finally { setListLoading(false); }
  }, [userEmail]);

  const loadDrafts = useCallback(async () => {
    setListLoading(true);
    try {
      const d = await emailApi({ action: 'list-drafts', email: userEmail });
      setDrafts(d.emails ?? []);
    } catch { /* silent */ } finally { setListLoading(false); }
  }, [userEmail]);

  useEffect(() => {
    emailApi({ action: 'check-connected', email: userEmail }).then(d => {
      setConnected(d.connected);
      setGmailAddress(d.gmail_address);
      if (d.connected) loadInbox();
    }).catch(() => setConnected(false));
  }, [userEmail, loadInbox]);

  useEffect(() => {
    if (!connected) return;
    if (tab === 'inbox') loadInbox();
    else if (tab === 'sent') loadSent();
    else loadDrafts();
  }, [tab, connected, loadInbox, loadSent, loadDrafts]);

  useEffect(() => {
    if (view !== 'list') return;
    const handler = (e: MessageEvent) => {
      if (e.data?.type !== 'gmail_callback') return;
      const { code, state } = e.data;
      emailApi({ action: 'callback', email: userEmail, code, state }).then(d => {
        setConnected(true);
        setGmailAddress(d.gmail_address);
        loadInbox();
      }).catch(err => setError(String(err)));
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [view, userEmail, loadInbox]);

  const connectGmail = async () => {
    setError('');
    try {
      const d = await emailApi({ action: 'auth-url', email: userEmail });
      window.open(d.url, 'gmail_auth', 'width=500,height=650,left=100,top=100');
    } catch (e) { setError(String(e)); }
  };

  const openMessage = async (id: string) => {
    setLoading(true);
    try {
      const d = await emailApi({ action: 'get-message', email: userEmail, messageId: id });
      setSelectedMsg(d);
      setView('read-message');
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  };

  const openStored = (item: StoredEmail) => {
    setSelectedStored(item);
    setView('read-stored');
  };

  const trashMessage = async (id: string) => {
    if (!window.confirm('Move this email to trash?')) return;
    await emailApi({ action: 'trash-message', email: userEmail, messageId: id });
    setView('list');
    loadInbox();
  };

  const deleteStored = async (item: StoredEmail) => {
    if (!window.confirm(item.status === 'sent' ? 'Delete this sent email?' : 'Delete this draft?')) return;
    await emailApi({ action: 'delete-email', email: userEmail, id: item.id });
    setView('list');
    if (item.status === 'sent') { setTab('sent'); loadSent(); }
    else { setTab('drafts'); loadDrafts(); }
  };

  const saveDraft = async () => {
    if (!composeBody.trim()) { setError('Body is required.'); return; }
    setLoading(true); setError('');
    try {
      await emailApi({ action: 'create-draft', email: userEmail, to: composeTo, subject: composeSubject, body: composeBody });
      setView('list'); setTab('drafts'); loadDrafts();
      setComposeTo(''); setComposeSubject(''); setComposeBody('');
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  };

  const sendNew = async () => {
    if (!composeTo.trim() || !composeBody.trim()) { setError('To and Body are required.'); return; }
    setSendStatus('sending'); setError('');
    try {
      await emailApi({ action: 'send-message', email: userEmail, to: composeTo, subject: composeSubject, body: composeBody });
      setSendStatus('sent');
      setTimeout(() => { setSendStatus(''); setView('list'); setTab('sent'); loadSent(); setComposeTo(''); setComposeSubject(''); setComposeBody(''); }, 1500);
    } catch (e) { setSendStatus('error'); setError(String(e)); }
  };

  const updateDraft = async () => {
    if (!selectedStored) return;
    setLoading(true); setError('');
    try {
      await emailApi({ action: 'update-draft', email: userEmail, id: selectedStored.id, to: composeTo, subject: composeSubject, body: composeBody });
      setView('list'); setTab('drafts'); loadDrafts();
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  };

  const sendDraft = async () => {
    if (!selectedStored) return;
    setSendStatus('sending'); setError('');
    try {
      await emailApi({ action: 'send-draft', email: userEmail, id: selectedStored.id });
      setSendStatus('sent');
      setTimeout(() => { setSendStatus(''); setView('list'); setTab('sent'); loadSent(); }, 1500);
    } catch (e) { setSendStatus('error'); setError(String(e)); }
  };

  const container: React.CSSProperties = {
    position: 'fixed', inset: 0, background: '#000', zIndex: 1000,
    display: 'flex', flexDirection: 'column', fontFamily: 'Fredoka, sans-serif',
  };
  const topBar: React.CSSProperties = {
    padding: '1.25rem 1.25rem 0', maxWidth: 480, margin: '0 auto',
    width: '100%', boxSizing: 'border-box',
  };
  const scrollArea: React.CSSProperties = {
    flex: 1, overflowY: 'auto', maxWidth: 480, margin: '0 auto',
    width: '100%', padding: '1rem 1.25rem', boxSizing: 'border-box',
  };

  const formatDate = (d: string | null) => {
    if (!d) return '';
    try { return new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }); } catch { return d; }
  };

  // --- Not connected ---
  if (connected === false) {
    return (
      <div style={container}>
        <div style={topBar}><BackBtn onClick={onBack} /></div>
        <div style={{ ...scrollArea, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
          <span style={{ color: CYAN, fontSize: '2rem', fontWeight: 700, marginBottom: '1rem' }}>NAVI Email</span>
          <span style={{ color: '#888', fontSize: '1rem', marginBottom: '1.5rem', lineHeight: 1.5 }}>
            Connect your Gmail account to read and manage your emails.
          </span>
          {error && <span style={{ color: RED, fontSize: '0.9rem', marginBottom: '1rem' }}>{error}</span>}
          <button style={{ ...btnCyan, width: '100%', marginBottom: '0.75rem' }} onClick={connectGmail}>
            Connect Gmail
          </button>
          <span style={{ color: '#333', fontSize: '0.75rem', lineHeight: 1.4 }}>
            NAVI only requests permission to read and manage your Gmail.
          </span>
        </div>
      </div>
    );
  }

  // --- Loading check ---
  if (connected === null) {
    return (
      <div style={container}>
        <div style={topBar}><BackBtn onClick={onBack} /></div>
        <div style={{ ...scrollArea, display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
          <span style={{ color: '#555' }}>Loading...</span>
        </div>
      </div>
    );
  }

  // --- Compose ---
  if (view === 'compose') {
    return (
      <div style={container}>
        <div style={topBar}><BackBtn onClick={() => { setView('list'); setError(''); setSendStatus(''); }} /></div>
        <div style={scrollArea}>
          <div style={{ color: '#fff', fontSize: '1.8rem', fontWeight: 700, marginBottom: '1.25rem' }}>New Email</div>
          {sendStatus === 'sent' && <div style={{ color: CYAN, fontSize: '1rem', marginBottom: '1rem', fontWeight: 700 }}>Sent!</div>}
          {error && <div style={{ color: RED, fontSize: '0.9rem', marginBottom: '0.75rem' }}>{error}</div>}
          <label style={labelStyle}>To</label>
          <input type="email" value={composeTo} onChange={e => setComposeTo(e.target.value)} style={{ ...inputStyle, marginBottom: '0.75rem' }} placeholder="recipient@example.com" />
          <label style={labelStyle}>Subject</label>
          <input type="text" value={composeSubject} onChange={e => setComposeSubject(e.target.value)} style={{ ...inputStyle, marginBottom: '0.75rem' }} placeholder="Subject" />
          <label style={labelStyle}>Body</label>
          <textarea value={composeBody} onChange={e => setComposeBody(e.target.value)} rows={8} style={{ ...inputStyle, marginBottom: '1rem', resize: 'vertical' }} placeholder="Write your message..." />
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button style={{ ...btnMag, flex: 1 }} onClick={saveDraft} disabled={loading}>{loading ? 'Saving...' : 'Save Draft'}</button>
            <button style={{ ...btnCyan, flex: 1 }} onClick={sendNew} disabled={sendStatus === 'sending'}>{sendStatus === 'sending' ? 'Sending...' : 'Send'}</button>
          </div>
        </div>
      </div>
    );
  }

  // --- Read inbox message (Gmail) ---
  if (view === 'read-message' && selectedMsg) {
    return (
      <div style={container}>
        <div style={topBar}><BackBtn onClick={() => setView('list')} /></div>
        <div style={scrollArea}>
          <div style={{ color: '#fff', fontSize: '1.4rem', fontWeight: 700, marginBottom: '0.5rem', lineHeight: 1.3 }}>{selectedMsg.subject || '(No subject)'}</div>
          <div style={{ color: '#888', fontSize: '0.85rem', marginBottom: '0.25rem' }}>From: {selectedMsg.from}</div>
          <div style={{ color: '#888', fontSize: '0.85rem', marginBottom: '0.25rem' }}>To: {selectedMsg.to}</div>
          <div style={{ color: '#555', fontSize: '0.8rem', marginBottom: '1rem' }}>{selectedMsg.date}</div>
          <div style={{ borderTop: '1px solid #111', marginBottom: '1rem' }} />
          <div style={{ color: '#fff', fontSize: '0.95rem', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginBottom: '1.5rem' }}>{selectedMsg.body}</div>
          <button style={{ ...btnMag, width: '100%' }} onClick={() => trashMessage(selectedMsg.id)}>Move to Trash</button>
        </div>
      </div>
    );
  }

  // --- Read stored email (sent or draft, from navi_emails) ---
  if (view === 'read-stored' && selectedStored) {
    const s = selectedStored;
    const dateStr = s.status === 'sent' ? (s.sent_at ?? s.created_at) : s.created_at;
    return (
      <div style={container}>
        <div style={topBar}><BackBtn onClick={() => { setView('list'); setTab(s.status === 'sent' ? 'sent' : 'drafts'); }} /></div>
        <div style={scrollArea}>
          <div style={{ color: '#fff', fontSize: '1.4rem', fontWeight: 700, marginBottom: '0.5rem', lineHeight: 1.3 }}>{s.subject || '(No subject)'}</div>
          <div style={{ color: '#888', fontSize: '0.85rem', marginBottom: '0.25rem' }}>To: {s.recipient || '(No recipient)'}</div>
          <div style={{ color: '#555', fontSize: '0.8rem', marginBottom: '1rem' }}>{s.status === 'sent' ? 'Sent' : 'Draft'} - {dateStr ? new Date(dateStr).toLocaleString('en-ZA') : ''}</div>
          <div style={{ borderTop: '1px solid #111', marginBottom: '1rem' }} />
          <div style={{ color: '#fff', fontSize: '0.95rem', lineHeight: 1.7, whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginBottom: '1.5rem' }}>{s.body}</div>
          {s.status === 'draft' ? (
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button style={{ ...btnCyan, flex: 1 }} onClick={() => {
                setComposeTo(s.recipient); setComposeSubject(s.subject); setComposeBody(s.body);
                setError(''); setSendStatus(''); setView('edit-draft');
              }}>Edit Draft</button>
              <button style={{ ...btnMag, flex: 1 }} onClick={() => deleteStored(s)}>Delete Draft</button>
            </div>
          ) : (
            <button style={{ ...btnMag, width: '100%' }} onClick={() => deleteStored(s)}>Delete</button>
          )}
        </div>
      </div>
    );
  }

  // --- Edit draft ---
  if (view === 'edit-draft' && selectedStored) {
    return (
      <div style={container}>
        <div style={topBar}><BackBtn onClick={() => { setView('read-stored'); setError(''); setSendStatus(''); }} /></div>
        <div style={scrollArea}>
          <div style={{ color: '#fff', fontSize: '1.8rem', fontWeight: 700, marginBottom: '1.25rem' }}>Edit Draft</div>
          {sendStatus === 'sent' && <div style={{ color: CYAN, fontSize: '1rem', marginBottom: '1rem', fontWeight: 700 }}>Sent!</div>}
          {error && <div style={{ color: RED, fontSize: '0.9rem', marginBottom: '0.75rem' }}>{error}</div>}
          <label style={labelStyle}>To</label>
          <input type="email" value={composeTo} onChange={e => setComposeTo(e.target.value)} style={{ ...inputStyle, marginBottom: '0.75rem' }} />
          <label style={labelStyle}>Subject</label>
          <input type="text" value={composeSubject} onChange={e => setComposeSubject(e.target.value)} style={{ ...inputStyle, marginBottom: '0.75rem' }} />
          <label style={labelStyle}>Body</label>
          <textarea value={composeBody} onChange={e => setComposeBody(e.target.value)} rows={8} style={{ ...inputStyle, marginBottom: '1rem', resize: 'vertical' }} />
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button style={{ ...btnMag, flex: 1 }} onClick={updateDraft} disabled={loading}>{loading ? 'Saving...' : 'Update Draft'}</button>
            <button style={{ ...btnCyan, flex: 1 }} onClick={sendDraft} disabled={sendStatus === 'sending'}>{sendStatus === 'sending' ? 'Sending...' : 'Send'}</button>
          </div>
        </div>
      </div>
    );
  }

  // --- List view (default) ---
  return (
    <div style={container}>
      <div style={{ maxWidth: 480, margin: '0 auto', width: '100%', padding: '1.25rem 1.25rem 0', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <BackBtn onClick={onBack} />
          <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center', flex: 1, overflowX: 'auto' }}>
            {(['inbox', 'sent', 'drafts'] as Tab[]).map(t => (
              <button key={t} onClick={() => setTab(t)} style={{
                background: 'none', border: 'none', padding: '0 0 6px', cursor: 'pointer',
                color: tab === t ? '#fff' : '#444', whiteSpace: 'nowrap',
                fontFamily: 'Fredoka, sans-serif', fontSize: '1.2rem', fontWeight: 700,
                borderBottom: tab === t ? `2px solid ${CYAN}` : '2px solid transparent',
              }}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
        </div>
        {gmailAddress && <div style={{ color: '#333', fontSize: '0.7rem', marginTop: 6, textAlign: 'right' }}>{gmailAddress}</div>}
      </div>
      <div style={scrollArea}>
        {error && <div style={{ color: RED, fontSize: '0.9rem', marginBottom: '0.75rem' }}>{error}</div>}
        {listLoading && <div style={{ color: '#555', textAlign: 'center', padding: '2rem 0' }}>Loading...</div>}

        {!listLoading && tab === 'inbox' && (
          inbox.length === 0
            ? <div style={{ color: '#333', textAlign: 'center', padding: '2rem 0' }}>No messages</div>
            : inbox.map(msg => (
              <button key={msg.id} onClick={() => openMessage(msg.id)} style={{ display: 'block', width: '100%', background: '#111', border: 'none', borderRadius: 10, padding: '1rem', marginBottom: '0.5rem', cursor: 'pointer', textAlign: 'left' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: '#fff', fontWeight: 700, fontSize: '0.95rem', fontFamily: 'Fredoka, sans-serif' }}>{msg.from.split('<')[0].trim() || msg.from}</span>
                  <span style={{ color: '#555', fontSize: '0.8rem', fontFamily: 'Fredoka, sans-serif' }}>{formatDate(msg.date)}</span>
                </div>
                <div style={{ color: '#fff', fontSize: '0.9rem', fontFamily: 'Fredoka, sans-serif', marginBottom: 3 }}>{msg.subject || '(No subject)'}</div>
                <div style={{ color: '#888', fontSize: '0.82rem', fontFamily: 'Fredoka, sans-serif', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{msg.snippet}</div>
              </button>
            ))
        )}

        {!listLoading && tab === 'sent' && (
          sent.length === 0
            ? <div style={{ color: '#333', textAlign: 'center', padding: '2rem 0' }}>No sent emails</div>
            : sent.map(item => (
              <button key={item.id} onClick={() => openStored(item)} style={{ display: 'block', width: '100%', background: '#111', border: 'none', borderRadius: 10, padding: '1rem', marginBottom: '0.5rem', cursor: 'pointer', textAlign: 'left' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: '#fff', fontWeight: 700, fontSize: '0.95rem', fontFamily: 'Fredoka, sans-serif' }}>To: {item.recipient || '(No recipient)'}</span>
                  <span style={{ color: '#555', fontSize: '0.8rem', fontFamily: 'Fredoka, sans-serif' }}>{formatDate(item.sent_at ?? item.created_at)}</span>
                </div>
                <div style={{ color: '#fff', fontSize: '0.9rem', fontFamily: 'Fredoka, sans-serif', marginBottom: 3 }}>{item.subject || '(No subject)'}</div>
                <div style={{ color: '#888', fontSize: '0.82rem', fontFamily: 'Fredoka, sans-serif', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{item.body}</div>
              </button>
            ))
        )}

        {!listLoading && tab === 'drafts' && (
          drafts.length === 0
            ? <div style={{ color: '#333', textAlign: 'center', padding: '2rem 0' }}>No drafts</div>
            : drafts.map(item => (
              <button key={item.id} onClick={() => openStored(item)} style={{ display: 'block', width: '100%', background: '#111', border: 'none', borderRadius: 10, padding: '1rem', marginBottom: '0.5rem', cursor: 'pointer', textAlign: 'left' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ color: '#fff', fontWeight: 700, fontSize: '0.95rem', fontFamily: 'Fredoka, sans-serif' }}>{item.recipient || 'No recipient'}</span>
                  <span style={{ color: '#555', fontSize: '0.8rem', fontFamily: 'Fredoka, sans-serif' }}>{formatDate(item.created_at)}</span>
                </div>
                <div style={{ color: '#fff', fontSize: '0.9rem', fontFamily: 'Fredoka, sans-serif', marginBottom: 3 }}>{item.subject || '(No subject)'}</div>
                <div style={{ color: '#888', fontSize: '0.82rem', fontFamily: 'Fredoka, sans-serif', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{item.body}</div>
              </button>
            ))
        )}

        <button style={{ ...btnCyan, width: '100%', marginTop: '1rem' }} onClick={() => { setComposeTo(''); setComposeSubject(''); setComposeBody(''); setError(''); setSendStatus(''); setView('compose'); }}>
          + Compose
        </button>
      </div>
    </div>
  );
};

export default EmailScreen;