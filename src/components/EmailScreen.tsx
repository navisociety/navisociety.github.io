import { FC, useEffect, useState } from 'react';

const SUPABASE_URL = 'https://irssegzkvxyewuxgqpwi.supabase.co';
const FUNCTION_URL = `${SUPABASE_URL}/functions/v1/navi-email`;

interface Props {
  userEmail: string;
  onBack: () => void;
}

interface Email {
  id: string;
  user_email: string;
  recipient: string;
  subject: string;
  body: string;
  status: 'draft' | 'sent';
  sent_at: string | null;
  created_at: string;
  updated_at: string;
}

type View = 'list' | 'compose' | 'read' | 'edit';

async function callEmail(action: string, payload: Record<string, unknown>) {
  const res = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, ...payload }),
  });
  return res.json();
}

function relativeDate(iso: string): string {
  const then = new Date(iso).getTime();
  const diff = Date.now() - then;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

const inputStyle: React.CSSProperties = {
  background: '#111',
  border: '1px solid #222',
  color: '#fff',
  borderRadius: '10px',
  padding: '0.75rem',
  fontFamily: 'Fredoka, sans-serif',
  fontSize: '1rem',
  width: '100%',
  boxSizing: 'border-box',
};

const labelStyle: React.CSSProperties = {
  color: '#555',
  fontSize: '0.85rem',
  marginBottom: '4px',
  display: 'block',
};

const cyanButton: React.CSSProperties = {
  background: '#00F7FF',
  color: '#000',
  border: 'none',
  borderRadius: '10px',
  fontWeight: 700,
  fontFamily: 'Fredoka, sans-serif',
  fontSize: '1rem',
  padding: '0.75rem',
  cursor: 'pointer',
};

const magentaOutlineButton: React.CSSProperties = {
  background: 'none',
  border: '2px solid #FA00FF',
  color: '#FA00FF',
  borderRadius: '10px',
  fontWeight: 700,
  fontFamily: 'Fredoka, sans-serif',
  fontSize: '1rem',
  padding: '0.75rem',
  cursor: 'pointer',
};

const EmailScreen: FC<Props> = ({ userEmail, onBack }) => {
  const [view, setView] = useState<View>('list');
  const [tab, setTab] = useState<'draft' | 'sent'>('draft');
  const [emails, setEmails] = useState<Email[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Email | null>(null);

  // form state
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');

  const loadList = async () => {
    setLoading(true);
    const data = await callEmail('list', { email: userEmail });
    setEmails(data.emails ?? []);
    setLoading(false);
  };

  useEffect(() => {
    loadList();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const goList = () => {
    setView('list');
    setError('');
    setNotice('');
    loadList();
  };

  const openCompose = () => {
    setTo('');
    setSubject('');
    setBody('');
    setError('');
    setNotice('');
    setActive(null);
    setView('compose');
  };

  const openRead = (email: Email) => {
    setActive(email);
    setView('read');
  };

  const openEdit = (email: Email) => {
    setTo(email.recipient);
    setSubject(email.subject);
    setBody(email.body);
    setError('');
    setNotice('');
    setActive(email);
    setView('edit');
  };

  const saveDraft = async () => {
    setBusy(true);
    setError('');
    if (active) {
      await callEmail('update', { email: userEmail, id: active.id, recipient: to, subject, body });
    } else {
      await callEmail('create', { email: userEmail, recipient: to, subject, body });
    }
    setBusy(false);
    goList();
  };

  const send = async () => {
    if (!to.trim() || !body.trim()) {
      setError('Recipient and message are required');
      return;
    }
    setBusy(true);
    setError('');
    const res = await callEmail('send', {
      email: userEmail,
      id: active?.id,
      recipient: to,
      subject,
      body,
    });
    setBusy(false);
    if (res.error) {
      setError('Could not send. Please try again.');
      return;
    }
    setNotice('Sent!');
    setTimeout(goList, 900);
  };

  const remove = async (email: Email) => {
    if (!confirm('Delete this email?')) return;
    await callEmail('delete', { email: userEmail, id: email.id });
    goList();
  };

  const overlay: React.CSSProperties = {
    position: 'fixed',
    inset: 0,
    background: '#000',
    zIndex: 1000,
    fontFamily: 'Fredoka, sans-serif',
    overflowY: 'auto',
  };

  const container: React.CSSProperties = {
    padding: '1.25rem',
    maxWidth: '480px',
    margin: '0 auto',
    width: '100%',
    boxSizing: 'border-box',
  };

  const BackButton: FC<{ onClick: () => void }> = ({ onClick }) => (
    <button onClick={onClick} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
      <div style={{ width: '42px', height: '42px', background: '#00F7FF', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
          <path d="M17 7H1M7 1L1 7l6 6" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
    </button>
  );

  const Heading: FC = () => (
    <span style={{ color: '#FFFFFF', fontSize: '2.4rem', fontWeight: 700, display: 'block', margin: '1.25rem 0' }}>Email</span>
  );

  const renderForm = (mode: 'compose' | 'edit') => (
    <div style={container}>
      <BackButton onClick={goList} />
      <Heading />
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <div>
          <label style={labelStyle}>To</label>
          <input style={inputStyle} type="email" value={to} onChange={(e) => setTo(e.target.value)} placeholder="name@example.com" />
        </div>
        <div>
          <label style={labelStyle}>Subject</label>
          <input style={inputStyle} type="text" value={subject} onChange={(e) => setSubject(e.target.value)} />
        </div>
        <div>
          <label style={labelStyle}>Message</label>
          <textarea style={{ ...inputStyle, minHeight: '9rem', resize: 'vertical' }} rows={6} value={body} onChange={(e) => setBody(e.target.value)} />
        </div>
        {error && <span style={{ color: '#FA0000', fontSize: '0.9rem' }}>{error}</span>}
        {notice && <span style={{ color: '#00F7FF', fontSize: '0.9rem' }}>{notice}</span>}
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button style={{ ...magentaOutlineButton, flex: 1 }} disabled={busy} onClick={saveDraft}>
            {mode === 'edit' ? 'Update Draft' : 'Save Draft'}
          </button>
          <button style={{ ...cyanButton, flex: 1 }} disabled={busy} onClick={send}>
            {busy ? 'Sending...' : 'Send'}
          </button>
        </div>
      </div>
    </div>
  );

  if (view === 'compose') return <div style={overlay}>{renderForm('compose')}</div>;
  if (view === 'edit') return <div style={overlay}>{renderForm('edit')}</div>;

  if (view === 'read' && active) {
    return (
      <div style={overlay}>
        <div style={container}>
          <BackButton onClick={goList} />
          <Heading />
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div>
              <label style={labelStyle}>From</label>
              <span style={{ color: '#fff' }}>NAVI / realnavicorp@gmail.com</span>
            </div>
            <div>
              <label style={labelStyle}>To</label>
              <span style={{ color: '#fff' }}>{active.recipient || '(none)'}</span>
            </div>
            <div>
              <label style={labelStyle}>Subject</label>
              <span style={{ color: '#fff' }}>{active.subject || '(no subject)'}</span>
            </div>
            <div>
              <label style={labelStyle}>Date</label>
              <span style={{ color: '#fff' }}>{relativeDate(active.sent_at ?? active.created_at)}</span>
            </div>
            <div>
              <label style={labelStyle}>Message</label>
              <span style={{ color: '#fff', whiteSpace: 'pre-wrap' }}>{active.body}</span>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
              {active.status === 'draft' && (
                <button style={{ ...cyanButton, flex: 1 }} onClick={() => openEdit(active)}>Edit</button>
              )}
              <button style={{ ...magentaOutlineButton, flex: 1 }} onClick={() => remove(active)}>Delete</button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const visible = emails.filter((e) => e.status === tab);

  return (
    <div style={overlay}>
      <div style={container}>
        <BackButton onClick={onBack} />
        <Heading />
        <div style={{ display: 'flex', gap: '1.5rem', marginBottom: '1.25rem' }}>
          <button
            onClick={() => setTab('draft')}
            style={{ background: 'none', border: 'none', color: '#fff', fontFamily: 'Fredoka, sans-serif', fontSize: '1rem', fontWeight: 700, padding: '0 0 6px', cursor: 'pointer', borderBottom: tab === 'draft' ? '2px solid #FA00FF' : '2px solid #333' }}
          >
            Drafts
          </button>
          <button
            onClick={() => setTab('sent')}
            style={{ background: 'none', border: 'none', color: '#fff', fontFamily: 'Fredoka, sans-serif', fontSize: '1rem', fontWeight: 700, padding: '0 0 6px', cursor: 'pointer', borderBottom: tab === 'sent' ? '2px solid #FA00FF' : '2px solid #333' }}
          >
            Sent
          </button>
        </div>

        {loading ? (
          <span style={{ color: '#555' }}>Loading...</span>
        ) : visible.length === 0 ? (
          <span style={{ color: '#555' }}>No {tab === 'draft' ? 'drafts' : 'sent emails'} yet</span>
        ) : (
          visible.map((email) => (
            <div
              key={email.id}
              onClick={() => openRead(email)}
              style={{ background: '#111', borderRadius: '10px', padding: '1rem', marginBottom: '0.75rem', cursor: 'pointer' }}
            >
              <div style={{ color: '#fff', fontWeight: 700 }}>{email.recipient || '(no recipient)'}</div>
              <div style={{ color: '#aaa', fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {email.subject || '(no subject)'}
              </div>
              <div style={{ color: '#555', fontSize: '0.8rem', marginTop: '0.25rem' }}>
                {relativeDate(email.sent_at ?? email.created_at)}
              </div>
            </div>
          ))
        )}

        <button style={{ ...cyanButton, width: '100%', marginTop: '1rem' }} onClick={openCompose}>Compose</button>
      </div>
    </div>
  );
};

export default EmailScreen;
