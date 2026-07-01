import { FC, useState, useEffect, useCallback, useRef, useMemo } from 'react';

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
  x: number | null;
  y: number | null;
  created_at: string;
}

const VISION_API = 'https://irssegzkvxyewuxgqpwi.supabase.co/functions/v1/navi-vision';

const CYAN = '#00F7FF';
const MAG = '#FA00FF';
const LIME = '#CCFF00';
const RED = '#FA0000';
const INK = '#1A1A2E';
const CARD_COLORS = [CYAN, MAG, LIME];

const TILE = 160;
const GAP = 14;
const ZOOM_MIN = 0.5;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 0.15;

function clampZoom(z: number) {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z));
}

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

// A fluffy cloud silhouette: a rounded body plus overlapping bumps along the top,
// unified into one shape via a shared drop-shadow on the wrapper.
const CloudPanel: FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{ position: 'relative', filter: 'drop-shadow(0 10px 18px rgba(26,26,46,0.12))', marginBottom: '1.5rem', ...style }}>
    <div style={{ position: 'absolute', top: -20, left: 22, width: 64, height: 64, borderRadius: '50%', background: '#fff' }} />
    <div style={{ position: 'absolute', top: -32, left: 78, width: 86, height: 86, borderRadius: '50%', background: '#fff' }} />
    <div style={{ position: 'absolute', top: -18, right: 60, width: 70, height: 70, borderRadius: '50%', background: '#fff' }} />
    <div style={{ position: 'absolute', top: -10, right: 16, width: 50, height: 50, borderRadius: '50%', background: '#fff' }} />
    <div style={{ position: 'relative', background: '#fff', borderRadius: 36, padding: '2.25rem 1.5rem 1.5rem' }}>
      {children}
    </div>
  </div>
);

const btnCyan: React.CSSProperties = {
  background: CYAN, color: '#000', border: 'none', borderRadius: 10,
  fontFamily: 'Fredoka, sans-serif', fontWeight: 700, fontSize: '1rem',
  padding: '0.75rem 1.2rem', cursor: 'pointer',
};

const btnGhost: React.CSSProperties = {
  background: 'none', color: INK, border: `1px solid ${INK}`, borderRadius: 10,
  fontFamily: 'Fredoka, sans-serif', fontWeight: 700, fontSize: '0.95rem',
  padding: '0.75rem 1.2rem', cursor: 'pointer',
};

const inputStyle: React.CSSProperties = {
  background: '#F5F8FF', border: '1px solid #DCE6F5', color: INK,
  borderRadius: 10, padding: '0.85rem', fontFamily: 'Fredoka, sans-serif',
  fontSize: '1rem', width: '100%', boxSizing: 'border-box', resize: 'vertical',
};

const fieldLabel: React.CSSProperties = {
  color: '#8892A6', fontSize: '0.8rem', fontWeight: 700,
  marginBottom: '0.5rem', fontFamily: 'Fredoka, sans-serif',
};

const container: React.CSSProperties = {
  position: 'fixed', inset: 0, background: '#FFFFFF', zIndex: 1000,
  display: 'flex', flexDirection: 'column', fontFamily: 'Fredoka, sans-serif',
  overflow: 'hidden',
};
const topBar: React.CSSProperties = {
  position: 'relative', zIndex: 1, padding: '1.25rem 1.25rem 0', maxWidth: 480, margin: '0 auto',
  width: '100%', boxSizing: 'border-box',
};
const scrollArea: React.CSSProperties = {
  position: 'relative', zIndex: 1, flex: 1, overflow: 'hidden', maxWidth: 480, margin: '0 auto',
  width: '100%', padding: '1rem 1.25rem', boxSizing: 'border-box',
  display: 'flex', flexDirection: 'column',
};

const addTopBtn: React.CSSProperties = {
  width: 42, height: 42, borderRadius: 10, background: CYAN, border: 'none',
  color: '#000', fontSize: '1.5rem', fontWeight: 700, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1, flexShrink: 0,
};

const zoomBtn: React.CSSProperties = {
  width: 36, height: 36, borderRadius: '50%', background: '#fff', border: `1px solid #DCE6F5`,
  color: INK, fontSize: '1.2rem', fontWeight: 700, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1,
  boxShadow: '0 2px 8px rgba(26,26,46,0.18)',
};

// Fallback grid slot for items that haven't been dragged yet (x/y still null).
function defaultSlot(index: number, cols: number) {
  const col = index % cols;
  const row = Math.floor(index / cols);
  return { x: col * (TILE + GAP), y: row * (TILE + GAP) };
}

const VisionBoardScreen: FC<VisionBoardScreenProps> = ({ onClose, session }) => {
  const email = session?.email ?? null;
  const [items, setItems] = useState<VisionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [goalText, setGoalText] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [zoom, setZoom] = useState(1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const [canvasWidth, setCanvasWidth] = useState(440);
  const dragState = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number; moved: boolean } | null>(null);
  const pinchPointers = useRef<Map<number, { x: number; y: number }>>(new Map());
  const pinchState = useRef<{ startDist: number; startZoom: number } | null>(null);
  const prevZoomRef = useRef(1);

  const loadItems = useCallback(async () => {
    if (!email) return;
    setLoading(true); setError('');
    try {
      const d = await callApi(VISION_API, { action: 'list-items', email });
      setItems(d.items ?? []);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, [email]);

  useEffect(() => { loadItems(); }, [loadItems]);

  useEffect(() => {
    const measure = () => { if (canvasRef.current) setCanvasWidth(canvasRef.current.clientWidth); };
    measure();
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, []);

  // Keep whatever point is currently at the center of the viewport anchored there
  // as zoom changes, instead of always zooming toward the top-left corner.
  useEffect(() => {
    const el = canvasRef.current;
    const oldZoom = prevZoomRef.current;
    prevZoomRef.current = zoom;
    if (!el || oldZoom === zoom) return;
    const centerX = el.scrollLeft + el.clientWidth / 2;
    const centerY = el.scrollTop + el.clientHeight / 2;
    const unscaledX = centerX / oldZoom;
    const unscaledY = centerY / oldZoom;
    el.scrollLeft = unscaledX * zoom - el.clientWidth / 2;
    el.scrollTop = unscaledY * zoom - el.clientHeight / 2;
  }, [zoom]);

  const cols = Math.max(1, Math.floor((canvasWidth + GAP) / (TILE + GAP)));

  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    let fallbackIndex = 0;
    for (const item of items) {
      if (item.x != null && item.y != null) {
        map.set(item.id, { x: item.x, y: item.y });
      } else {
        map.set(item.id, defaultSlot(fallbackIndex, cols));
        fallbackIndex++;
      }
    }
    return map;
  }, [items, cols]);

  const canvasHeight = useMemo(() => {
    let maxY = 0;
    for (const p of positions.values()) maxY = Math.max(maxY, p.y + TILE);
    return Math.max(maxY + GAP, 320);
  }, [positions]);

  const zoomBy = (delta: number) => setZoom(z => clampZoom(z + delta));
  const resetZoom = () => setZoom(1);

  // Two-finger pinch: single-finger touches still pan the board natively (touchAction
  // allows that); once a 2nd pointer joins we take over and scale, then hand back
  // control once fewer than 2 pointers remain.
  const onViewportPointerDown = (e: React.PointerEvent) => {
    if (dragState.current) return;
    pinchPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchPointers.current.size === 2) {
      const pts = Array.from(pinchPointers.current.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      pinchState.current = { startDist: dist || 1, startZoom: zoom };
    }
  };

  const onViewportPointerMove = (e: React.PointerEvent) => {
    if (!pinchPointers.current.has(e.pointerId)) return;
    pinchPointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinchPointers.current.size >= 2 && pinchState.current) {
      e.preventDefault();
      const pts = Array.from(pinchPointers.current.values());
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const ratio = dist / pinchState.current.startDist;
      setZoom(clampZoom(pinchState.current.startZoom * ratio));
    }
  };

  const onViewportPointerUp = (e: React.PointerEvent) => {
    pinchPointers.current.delete(e.pointerId);
    if (pinchPointers.current.size < 2) pinchState.current = null;
  };

  if (!email) {
    return (
      <div style={container}>
        <div style={topBar}><BackBtn onClick={onClose} /></div>
        <div style={{ ...scrollArea, justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
          <span style={{ color: INK, fontSize: '1.2rem', fontWeight: 700 }}>Sign in to use Vision Board</span>
          <span style={{ color: '#8892A6', fontSize: '0.9rem', marginTop: '0.5rem' }}>Open the menu and sign in first.</span>
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

  const clampX = (x: number) => Math.max(0, Math.min(x, Math.max(canvasWidth - TILE, 0)));
  const clampY = (y: number) => Math.max(0, y);

  const onTilePointerDown = (e: React.PointerEvent, item: VisionItem) => {
    if (e.button !== undefined && e.button !== 0) return;
    const pos = positions.get(item.id)!;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = { id: item.id, startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y, moved: false };
  };

  const onTilePointerMove = (e: React.PointerEvent, item: VisionItem) => {
    const drag = dragState.current;
    if (!drag || drag.id !== item.id) return;
    const dx = (e.clientX - drag.startX) / zoom;
    const dy = (e.clientY - drag.startY) / zoom;
    if (!drag.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    drag.moved = true;
    const nx = clampX(drag.origX + dx);
    const ny = clampY(drag.origY + dy);
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, x: nx, y: ny } : i));
  };

  const onTilePointerUp = async (e: React.PointerEvent, item: VisionItem) => {
    const drag = dragState.current;
    dragState.current = null;
    if (!drag || drag.id !== item.id || !drag.moved) return;
    const final = positions.get(item.id);
    const nx = final?.x ?? drag.origX;
    const ny = final?.y ?? drag.origY;
    try {
      await callApi(VISION_API, { action: 'move-item', email, id: item.id, x: nx, y: ny });
    } catch (err) { setError(String(err)); }
  };

  return (
    <div style={container}>
      <div style={topBar}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <BackBtn onClick={onClose} />
            <span style={{ color: INK, fontSize: '1.6rem', fontWeight: 700 }}>Vision Board</span>
          </div>
          <button onClick={() => setShowAdd(true)} title="Add a goal" style={addTopBtn}>+</button>
        </div>
      </div>
      <div style={scrollArea}>
        {error && <div style={{ color: RED, fontSize: '0.9rem', marginBottom: '0.75rem' }}>{error}</div>}
        {loading && <div style={{ color: '#8892A6', textAlign: 'center', padding: '2rem 0' }}>Loading...</div>}

        {!loading && (
          <div
            ref={canvasRef}
            onPointerDown={onViewportPointerDown}
            onPointerMove={onViewportPointerMove}
            onPointerUp={onViewportPointerUp}
            onPointerCancel={onViewportPointerUp}
            style={{
              position: 'relative', width: '100%', flex: 1, overflow: 'auto',
              borderRadius: 14, touchAction: 'pan-x pan-y',
            }}
          >
            <div style={{ position: 'relative', width: canvasWidth * zoom, height: canvasHeight * zoom }}>
              {items.length === 0 && (
                <div style={{
                  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                  color: '#8892A6', textAlign: 'center', padding: '0 2rem', pointerEvents: 'none',
                }}>
                  Your board is empty. Tap + to add a goal or image.
                </div>
              )}
              <div
                style={{
                  position: 'relative', width: canvasWidth, height: canvasHeight,
                  transform: `scale(${zoom})`, transformOrigin: '0 0',
                  background: 'radial-gradient(#E3ECFB 1.5px, transparent 1.5px)',
                  backgroundSize: '18px 18px',
                }}
              >
                {items.map((item, i) => {
                  const pos = positions.get(item.id) ?? { x: 0, y: 0 };
                  return (
                    <div
                      key={item.id}
                      onPointerDown={e => onTilePointerDown(e, item)}
                      onPointerMove={e => onTilePointerMove(e, item)}
                      onPointerUp={e => onTilePointerUp(e, item)}
                      onPointerCancel={e => onTilePointerUp(e, item)}
                      style={{
                        position: 'absolute', left: pos.x, top: pos.y, width: TILE, height: TILE,
                        borderRadius: 14, overflow: 'hidden', cursor: 'grab', touchAction: 'none',
                        userSelect: 'none', boxShadow: '0 4px 14px rgba(26,26,46,0.18)',
                      }}
                    >
                      {item.kind === 'image' ? (
                        <img src={item.content} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }} />
                      ) : (
                        <div style={{
                          width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                          background: '#0a0a0a', border: `2px solid ${CARD_COLORS[i % CARD_COLORS.length]}`,
                          padding: '1rem', boxSizing: 'border-box', textAlign: 'center', pointerEvents: 'none',
                        }}>
                          <span style={{ color: '#fff', fontWeight: 700, fontSize: '0.9rem', lineHeight: 1.3 }}>{item.content}</span>
                        </div>
                      )}
                      <button
                        onPointerDown={e => e.stopPropagation()}
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
                  );
                })}
              </div>
            </div>
          </div>
        )}

        <div style={{
          position: 'absolute', bottom: '1rem', left: '50%', transform: 'translateX(-50%)',
          display: 'flex', alignItems: 'center', gap: '0.6rem', background: 'rgba(255,255,255,0.9)',
          padding: '0.4rem 0.6rem', borderRadius: 999, boxShadow: '0 4px 14px rgba(26,26,46,0.18)', zIndex: 3,
        }}>
          <button onClick={() => zoomBy(-ZOOM_STEP)} title="Zoom out" style={zoomBtn}>&minus;</button>
          <button onClick={resetZoom} title="Reset zoom" style={{ color: INK, fontSize: '0.8rem', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', minWidth: 38 }}>
            {Math.round(zoom * 100)}%
          </button>
          <button onClick={() => zoomBy(ZOOM_STEP)} title="Zoom in" style={zoomBtn}>+</button>
        </div>
      </div>

      {showAdd && (
        <div style={{
          position: 'fixed', inset: 0, background: MAG, zIndex: 1200,
          display: 'flex', flexDirection: 'column', fontFamily: 'Fredoka, sans-serif',
        }}>
          <div style={{ padding: '1.25rem 1.25rem 0', maxWidth: 480, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
            <BackBtn onClick={() => setShowAdd(false)} />
          </div>
          <div style={{ flex: 1, overflowY: 'auto', maxWidth: 480, margin: '0 auto', width: '100%', padding: '1rem 1.25rem 2rem', boxSizing: 'border-box' }}>
            <CloudPanel>
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
            </CloudPanel>
            {error && <div style={{ color: '#000', fontWeight: 700, fontSize: '0.9rem' }}>{error}</div>}
          </div>
        </div>
      )}
    </div>
  );
};

export default VisionBoardScreen;
