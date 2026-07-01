import { FC, useState, useEffect, useCallback } from 'react';

interface CreateScreenProps {
  onClose: () => void;
  session: { email: string } | null;
}

interface Creation {
  id: string;
  user_email: string;
  title: string;
  prompt: string;
  status: 'pending' | 'processing' | 'ready' | 'failed';
  created_at: string;
  updated_at: string;
}

const CREATE_API = 'https://irssegzkvxyewuxgqpwi.supabase.co/functions/v1/navi-create';

const CYAN = '#00F7FF';
const MAG = '#FA00FF';
const RED = '#FA0000';

async function callApi(url: string, body: Record<string, unknown>) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
  return data;
}

function statusColor(status: string): string {
  if (status === 'failed') return RED;
  return '#888';
}

const BackBtn: FC<{ onClick: () => void }> = ({ onClick }) => (
  <button onClick={onClick} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0 }}>
    <div style={{ width: 42, height: 42, background: CYAN, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
        <path d="M17 7H1M7 1L1 7l6 6" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  </button>
);

const btnCyan: React.CSSProperties = {
  background: CYAN, color: '#000', border: 'none', borderRadius: 10,
  fontFamily: 'Fredoka, sans-serif', fontWeight: 700, fontSize: '1rem',
  padding: '0.75rem 1.2rem', cursor: 'pointer',
};

const inputStyle: React.CSSProperties = {
  background: '#111', border: '1px solid #222', color: '#fff',
  borderRadius: 10, padding: '0.85rem', fontFamily: 'Fredoka, sans-serif',
  fontSize: '1rem', width: '100%', boxSizing: 'border-box', resize: 'vertical',
};

const fieldLabel: React.CSSProperties = {
  color: '#888', fontSize: '0.8rem', fontWeight: 700,
  marginBottom: '0.5rem', fontFamily: 'Fredoka, sans-serif',
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

const NaviAvatar: FC = () => (
  <div style={{ width: 28, height: 28, borderRadius: 8, background: MAG, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontWeight: 700, color: '#000', fontSize: '0.85rem' }}>
    N
  </div>
);

const CreateScreen: FC<CreateScreenProps> = ({ onClose, session }) => {
  const email = session?.email ?? null;
  const [view, setView] = useState<'list' | 'creation'>('list');
  const [creations, setCreations] = useState<Creation[]>([]);
  const [activeCreation, setActiveCreation] = useState<Creation | null>(null);
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [naviMessage, setNaviMessage] = useState('');
  const [error, setError] = useState('');

  const loadCreations = useCallback(async () => {
    if (!email) return;
    setListLoading(true); setError('');
    try {
      const d = await callApi(CREATE_API, { action: 'list-creations', email });
      setCreations(d.creations ?? []);
    } catch (e) { setError(String(e)); } finally { setListLoading(false); }
  }, [email]);

  useEffect(() => {
    if (!email) return;
    loadCreations();
  }, [email, loadCreations]);

  // --- Not signed in ---
  if (!email) {
    return (
      <div style={container}>
        <div style={topBar}><BackBtn onClick={onClose} /></div>
        <div style={{ ...scrollArea, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
          <span style={{ color: '#fff', fontSize: '1.2rem', fontWeight: 700 }}>Sign in to use Create</span>
          <span style={{ color: '#555', fontSize: '0.9rem', marginTop: '0.5rem' }}>Open the menu and sign in first.</span>
        </div>
      </div>
    );
  }

  const openCreation = (cr: Creation) => {
    setActiveCreation(cr);
    setPrompt(cr.prompt);
    setNaviMessage('Saved.');
    setView('creation');
  };

  const newCreation = () => {
    setActiveCreation(null);
    setPrompt('');
    setNaviMessage('');
    setError('');
    setView('creation');
  };

  const submitCreation = async () => {
    const clean = prompt.trim();
    if (!clean) { setError('Please type what the design should say.'); return; }
    setLoading(true); setError(''); setNaviMessage('');
    try {
      const d = await callApi(CREATE_API, { action: 'create-creation', email, prompt: clean });
      setActiveCreation(d as Creation);
      setNaviMessage(d.naviMessage ?? 'Saved.');
      loadCreations();
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  };

  const deleteCreation = async (cr: Creation, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Delete this creation?')) return;
    try {
      await callApi(CREATE_API, { action: 'delete-creation', email, id: cr.id });
      if (activeCreation?.id === cr.id) { setActiveCreation(null); setView('list'); }
      loadCreations();
    } catch (err) { setError(String(err)); }
  };

  const formatDate = (d: string) => {
    try { return new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }); } catch { return d; }
  };

  // --- Creation view ---
  if (view === 'creation') {
    return (
      <div style={container}>
          <div style={topBar}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <BackBtn onClick={() => { setView('list'); setError(''); loadCreations(); }} />
              <span style={{ color: '#444', fontSize: '1.1rem', fontWeight: 700 }}>Creations</span>
            </div>
          </div>
        </div>
        <div style={scrollArea}>
          <div style={{ background: '#0a0a0a', border: `1px solid ${MAG}`, borderRadius: 14, padding: '1.5rem', marginBottom: '1.25rem', textAlign: 'center' }}>
            <span style={{ color: '#fff', fontSize: '1.5rem', fontWeight: 700, lineHeight: 1.3 }}>What would you like me to create?</span>
          </div>

          {error && <div style={{ color: RED, fontSize: '0.9rem', marginBottom: '0.75rem' }}>{error}</div>}

          <div style={fieldLabel}>What should the design say?</div>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={6}
            placeholder={'First line is the headline.\nThe rest becomes the body text.'}
            style={{ ...inputStyle, marginBottom: '1rem' }}
          />

          <button style={{ ...btnCyan, width: '100%' }} onClick={submitCreation} disabled={loading}>
            {loading ? 'Saving...' : 'Save'}
          </button>

          {naviMessage && (
            <div style={{ marginTop: '1.5rem', borderTop: '1px solid #111', paddingTop: '1.25rem' }}>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', background: '#000', border: `1px solid ${CYAN}`, borderRadius: 14, padding: '1rem' }}>
                <NaviAvatar />
                <span style={{ color: '#fff', fontSize: '0.95rem', lineHeight: 1.6 }}>{naviMessage}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- List view ---
  return (
    <div style={container}>
      <div style={topBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <BackBtn onClick={onClose} />
            <span style={{ color: '#fff', fontSize: '1.6rem', fontWeight: 700 }}>Create</span>
          </div>
        </div>
      </div>
      <div style={scrollArea}>
        <button style={{ ...btnCyan, width: '100%', marginBottom: '1.25rem' }} onClick={newCreation}>
          + New Creation
        </button>

        {error && <div style={{ color: RED, fontSize: '0.9rem', marginBottom: '0.75rem' }}>{error}</div>}
        {listLoading && <div style={{ color: '#555', textAlign: 'center', padding: '2rem 0' }}>Loading...</div>}

        {!listLoading && creations.length === 0 && (
          <div style={{ color: '#333', textAlign: 'center', padding: '2rem 0' }}>No creations yet</div>
        )}

        {!listLoading && creations.map(cr => (
          <button key={cr.id} onClick={() => openCreation(cr)} style={{ display: 'block', width: '100%', background: '#111', border: 'none', borderRadius: 10, padding: '1rem', marginBottom: '0.5rem', cursor: 'pointer', textAlign: 'left' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ color: '#fff', fontWeight: 700, fontSize: '0.95rem', fontFamily: 'Fredoka, sans-serif', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', marginRight: '0.5rem' }}>{cr.title}</span>
              <span style={{ color: '#555', fontSize: '0.8rem', fontFamily: 'Fredoka, sans-serif', flexShrink: 0 }}>{formatDate(cr.created_at)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: statusColor(cr.status), fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, border: `1px solid ${statusColor(cr.status)}`, borderRadius: 999, padding: '2px 10px' }}>{cr.status}</span>
              <span onClick={(e) => deleteCreation(cr, e)} style={{ color: '#555', fontSize: '0.8rem', cursor: 'pointer', padding: '4px 8px' }} title="Delete">Delete</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default CreateScreen;
