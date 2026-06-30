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
  canva_design_id: string | null;
  canva_edit_url: string | null;
  canva_export_url: string | null;
  created_at: string;
  updated_at: string;
}

interface CanvaStatus {
  connected: boolean;
  setupPending: boolean;
}

const CREATE_API = 'https://irssegzkvxyewuxgqpwi.supabase.co/functions/v1/navi-create';
const CANVA_API = 'https://irssegzkvxyewuxgqpwi.supabase.co/functions/v1/navi-canva-auth';

const CYAN = '#00F7FF';
const MAG = '#FA00FF';
const LIME = '#CCFF00';
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

function messageForStatus(status: string): string {
  if (status === 'ready') return 'Your design is ready in Canva! Tap the button below to open and export it.';
  if (status === 'failed') return 'I ran into an issue generating your design. Please try again.';
  if (status === 'processing') return 'Working on your design...';
  return 'Your prompt is saved. Connect Canva to generate the design.';
}

function statusColor(status: string): string {
  if (status === 'ready') return LIME;
  if (status === 'failed') return RED;
  if (status === 'processing') return CYAN;
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

const ConnectCanvaPanel: FC<{ canvaStatus: CanvaStatus | null; connecting: boolean; onConnect: () => void }> = ({ canvaStatus, connecting, onConnect }) => {
  if (canvaStatus?.setupPending) {
    return (
      <div style={{ background: '#0a0a0a', border: `1px solid ${MAG}`, borderRadius: 14, padding: '1.25rem', marginBottom: '1.25rem', textAlign: 'center' }}>
        <span style={{ color: '#fff', fontSize: '1.05rem', fontWeight: 700 }}>Canva coming soon</span>
        <div style={{ color: '#888', fontSize: '0.85rem', marginTop: 6 }}>Your prompts are saved and will generate once Canva is connected.</div>
      </div>
    );
  }
  return (
    <div style={{ background: '#0a0a0a', border: `1px solid ${CYAN}`, borderRadius: 14, padding: '1.25rem', marginBottom: '1.25rem', textAlign: 'center' }}>
      <span style={{ color: '#fff', fontSize: '1.05rem', fontWeight: 700 }}>Connect your Canva account</span>
      <div style={{ color: '#888', fontSize: '0.85rem', marginTop: 6, marginBottom: '1rem' }}>to generate designs automatically</div>
      <button style={{ ...btnCyan, width: '100%' }} onClick={onConnect} disabled={connecting}>
        {connecting ? 'Connecting...' : 'Connect Canva'}
      </button>
    </div>
  );
};

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
  const [canvaStatus, setCanvaStatus] = useState<CanvaStatus | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [showConnect, setShowConnect] = useState(false);
  const [toast, setToast] = useState('');

  const loadCreations = useCallback(async () => {
    if (!email) return;
    setListLoading(true); setError('');
    try {
      const d = await callApi(CREATE_API, { action: 'list-creations', email });
      setCreations(d.creations ?? []);
    } catch (e) { setError(String(e)); } finally { setListLoading(false); }
  }, [email]);

  const loadCanvaStatus = useCallback(async () => {
    if (!email) return;
    try {
      const d = await callApi(CANVA_API, { action: 'get-status', email });
      setCanvaStatus({ connected: !!d.connected, setupPending: !!d.setupPending });
      if (d.connected) setShowConnect(false);
    } catch { setCanvaStatus({ connected: false, setupPending: false }); }
  }, [email]);

  useEffect(() => {
    if (!email) return;
    loadCreations();
    loadCanvaStatus();
  }, [email, loadCreations, loadCanvaStatus]);

  // Handle OAuth return (?canva_connected=true)
  useEffect(() => {
    if (!email) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('canva_connected') === 'true') {
      params.delete('canva_connected');
      const qs = params.toString();
      window.history.replaceState({}, '', window.location.pathname + (qs ? `?${qs}` : ''));
      setToast('Canva connected!');
      setShowConnect(false);
      loadCanvaStatus();
      setTimeout(() => setToast(''), 3000);
    }
  }, [email, loadCanvaStatus]);

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

  const connectCanva = async () => {
    setConnecting(true); setError('');
    try {
      const d = await callApi(CANVA_API, { action: 'start-oauth', email });
      if (d.setupPending) {
        setCanvaStatus({ connected: false, setupPending: true });
      } else if (d.url) {
        window.open(d.url, '_blank');
      }
    } catch (e) { setError(String(e)); } finally { setConnecting(false); }
  };

  const disconnectCanva = async () => {
    if (!window.confirm('Disconnect your Canva account?')) return;
    try {
      await callApi(CANVA_API, { action: 'disconnect', email });
      setCanvaStatus({ connected: false, setupPending: canvaStatus?.setupPending ?? false });
    } catch (e) { setError(String(e)); }
  };

  const openCreation = (cr: Creation) => {
    setActiveCreation(cr);
    setPrompt(cr.prompt);
    setNaviMessage(messageForStatus(cr.status));
    setShowConnect(false);
    setView('creation');
  };

  const newCreation = () => {
    setActiveCreation(null);
    setPrompt('');
    setNaviMessage('');
    setError('');
    setShowConnect(false);
    setView('creation');
  };

  const submitCreation = async () => {
    const clean = prompt.trim();
    if (!clean) { setError('Please describe what you want me to create.'); return; }
    setLoading(true); setError(''); setNaviMessage('');
    try {
      const d = await callApi(CREATE_API, { action: 'create-creation', email, prompt: clean });
      setActiveCreation(d as Creation);
      setNaviMessage(d.naviMessage ?? messageForStatus(d.status));
      if (d.needsCanvaAuth) { setShowConnect(true); loadCanvaStatus(); }
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

  const editUrl = activeCreation?.canva_edit_url;
  const isConnected = canvaStatus?.connected ?? false;

  const Toast = toast ? (
    <div style={{ position: 'fixed', top: 16, left: '50%', transform: 'translateX(-50%)', background: LIME, color: '#000', fontWeight: 700, padding: '0.6rem 1.2rem', borderRadius: 999, zIndex: 1100, fontFamily: 'Fredoka, sans-serif' }}>
      {toast}
    </div>
  ) : null;

  const CanvaPill = (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {isConnected ? (
        <>
          <span style={{ color: LIME, fontSize: '0.72rem', fontWeight: 700, border: `1px solid ${LIME}`, borderRadius: 999, padding: '2px 10px' }}>Canva connected</span>
          <span onClick={disconnectCanva} style={{ color: '#555', fontSize: '0.75rem', cursor: 'pointer' }}>Disconnect</span>
        </>
      ) : null}
    </div>
  );

  // --- Creation view ---
  if (view === 'creation') {
    const needPanel = showConnect || (!isConnected);
    return (
      <div style={container}>
        {Toast}
        <div style={topBar}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <BackBtn onClick={() => { setView('list'); setError(''); loadCreations(); }} />
              <span style={{ color: '#444', fontSize: '1.1rem', fontWeight: 700 }}>Creations</span>
            </div>
            {CanvaPill}
          </div>
        </div>
        <div style={scrollArea}>
          {needPanel && (
            <ConnectCanvaPanel canvaStatus={canvaStatus} connecting={connecting} onConnect={connectCanva} />
          )}

          <div style={{ background: '#0a0a0a', border: `1px solid ${MAG}`, borderRadius: 14, padding: '1.5rem', marginBottom: '1.25rem', textAlign: 'center' }}>
            <span style={{ color: '#fff', fontSize: '1.5rem', fontWeight: 700, lineHeight: 1.3 }}>What would you like me to create?</span>
          </div>

          {error && <div style={{ color: RED, fontSize: '0.9rem', marginBottom: '0.75rem' }}>{error}</div>}

          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={5}
            placeholder="e.g. A bold Instagram post announcing our Sunday service..."
            style={{ ...inputStyle, marginBottom: '1rem' }}
          />
          <button style={{ ...btnCyan, width: '100%' }} onClick={submitCreation} disabled={loading}>
            {loading ? 'Creating...' : 'Create in Canva'}
          </button>

          {naviMessage && (
            <div style={{ marginTop: '1.5rem', borderTop: '1px solid #111', paddingTop: '1.25rem' }}>
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', background: '#000', border: `1px solid ${CYAN}`, borderRadius: 14, padding: '1rem' }}>
                <NaviAvatar />
                <span style={{ color: '#fff', fontSize: '0.95rem', lineHeight: 1.6 }}>{naviMessage}</span>
              </div>
              {editUrl ? (
                <a href={editUrl} target="_blank" rel="noopener noreferrer" style={{ ...btnCyan, display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: '0.75rem' }}>
                  Open in Canva &rarr;
                </a>
              ) : null}
            </div>
          )}
        </div>
      </div>
    );
  }

  // --- List view ---
  return (
    <div style={container}>
      {Toast}
      <div style={topBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <BackBtn onClick={onClose} />
            <span style={{ color: '#fff', fontSize: '1.6rem', fontWeight: 700 }}>Create</span>
          </div>
          {CanvaPill}
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
