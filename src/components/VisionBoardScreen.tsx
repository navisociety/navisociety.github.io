import { FC, useState, useEffect, useCallback, useRef } from 'react';

interface VisionBoardScreenProps {
  onClose: () => void;
  session: { email: string } | null;
}

interface VisionItem {
  id: string;
  user_email: string;
  kind: 'image' | 'text';
  content: string;
  position: number;
  created_at: string;
}

const VISION_API = 'https://irssegzkvxyewuxgqpwi.supabase.co/functions/v1/navi-vision';

const CYAN = '#00F7FF';
const MAG = '#FA00FF';
const LIME = '#CCFF00';
const RED = '#FA0000';
const CARD_COLORS = [CYAN, MAG, LIME];

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

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1] ?? '');
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
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

const btnGhost: React.CSSProperties = {
  background: 'none', color: CYAN, border: `1px solid ${CYAN}`, borderRadius: 10,
  fontFamily: 'Fredoka, sans-serif', fontWeight: 700, fontSize: '0.95rem',
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

const VisionBoardScreen: FC<VisionBoardScreenProps> = ({ onClose, session }) => {
  const email = session?.email ?? null;
  const [items, setItems] = useState<VisionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [goalText, setGoalText] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadItems = useCallback(async () => {
    if (!email) return;
    setLoading(true); setError('');
    try {
      const d = await callApi(VISION_API, { action: 'list-items', email });
      setItems(d.items ?? []);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, [email]);

  useEffect(() => { loadItems(); }, [loadItems]);

  if (!email) {
    return (
      <div style={container}>
        <div style={topBar}><BackBtn onClick={onClose} /></div>
        <div style={{ ...scrollArea, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
          <span style={{ color: '#fff', fontSize: '1.2rem', fontWeight: 700 }}>Sign in to use Vision Board</span>
          <span style={{ color: '#555', fontSize: '0.9rem', marginTop: '0.5rem' }}>Open the menu and sign in first.</span>
        </div>
      </div>
    );
  }

  const addGoal = async () => {
    const clean = goalText.trim();
    if (!clean) return;
    setAdding(true); setError('');
    try {
      await callApi(VISION_API, { action: 'add-text', email, text: clean });
      setGoalText('');
      loadItems();
    } catch (e) { setError(String(e)); } finally { setAdding(false); }
  };

  const addImageUrl = async () => {
    const clean = imageUrl.trim();
    if (!clean) return;
    setAdding(true); setError('');
    try {
      await callApi(VISION_API, { action: 'add-image', email, imageUrl: clean });
      setImageUrl('');
      loadItems();
    } catch (e) { setError(String(e)); } finally { setAdding(false); }
  };

  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setAdding(true); setError('');
    try {
      const dataBase64 = await fileToBase64(file);
      await callApi(VISION_API, { action: 'add-image', email, dataBase64, contentType: file.type });
      loadItems();
    } catch (err) { setError(String(err)); } finally { setAdding(false); }
  };

  const deleteItem = async (item: VisionItem) => {
    if (!window.confirm('Remove this from your vision board?')) return;
    try {
      await callApi(VISION_API, { action: 'delete-item', email, id: item.id });
      setItems(prev => prev.filter(i => i.id !== item.id));
    } catch (e) { setError(String(e)); }
  };

  return (
    <div style={container}>
      <div style={topBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <BackBtn onClick={onClose} />
          <span style={{ color: '#fff', fontSize: '1.6rem', fontWeight: 700 }}>Vision Board</span>
        </div>
      </div>
      <div style={scrollArea}>
        <div style={{ background: '#0a0a0a', border: `1px solid ${MAG}`, borderRadius: 14, padding: '1.25rem', marginBottom: '1.25rem' }}>
          <div style={fieldLabel}>Add a goal</div>
          <textarea
            value={goalText}
            onChange={e => setGoalText(e.target.value)}
            rows={2}
            placeholder="e.g. Launch my business by December"
            style={{ ...inputStyle, marginBottom: '0.75rem' }}
          />
          <button style={{ ...btnCyan, width: '100%', marginBottom: '1.1rem' }} onClick={addGoal} disabled={adding || !goalText.trim()}>
            + Add Goal
          </button>

          <div style={fieldLabel}>Add an image</div>
          <input
            value={imageUrl}
            onChange={e => setImageUrl(e.target.value)}
            placeholder="Paste an image URL..."
            style={{ ...inputStyle, marginBottom: '0.75rem' }}
          />
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button style={{ ...btnGhost, flex: 1 }} onClick={addImageUrl} disabled={adding || !imageUrl.trim()}>
              Add URL
            </button>
            <button style={{ ...btnCyan, flex: 1 }} onClick={() => fileInputRef.current?.click()} disabled={adding}>
              {adding ? 'Adding...' : 'Upload Image'}
            </button>
          </div>
          <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={onFilePicked} style={{ display: 'none' }} />
        </div>

        {error && <div style={{ color: RED, fontSize: '0.9rem', marginBottom: '0.75rem' }}>{error}</div>}
        {loading && <div style={{ color: '#555', textAlign: 'center', padding: '2rem 0' }}>Loading...</div>}

        {!loading && items.length === 0 && (
          <div style={{ color: '#333', textAlign: 'center', padding: '2rem 0' }}>Your board is empty. Add a goal or image above.</div>
        )}

        {!loading && items.length > 0 && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
            {items.map((item, i) => (
              <div key={item.id} style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', aspectRatio: '1 / 1' }}>
                {item.kind === 'image' ? (
                  <img src={item.content} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                ) : (
                  <div style={{
                    width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    background: '#0a0a0a', border: `2px solid ${CARD_COLORS[i % CARD_COLORS.length]}`,
                    padding: '1rem', boxSizing: 'border-box', textAlign: 'center',
                  }}>
                    <span style={{ color: '#fff', fontWeight: 700, fontSize: '0.95rem', lineHeight: 1.35 }}>{item.content}</span>
                  </div>
                )}
                <button
                  onClick={() => deleteItem(item)}
                  title="Remove"
                  style={{
                    position: 'absolute', top: 6, right: 6, width: 26, height: 26, borderRadius: '50%',
                    background: 'rgba(0,0,0,0.7)', border: `1px solid ${RED}`, color: RED,
                    fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1,
                  }}
                >
                  &times;
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

export default VisionBoardScreen;
