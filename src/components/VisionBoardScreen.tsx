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
  name: string | null;
  notes: string | null;
  shape: 'circle' | 'square';
  size: number;
  position: number;
  x: number | null;
  y: number | null;
  created_at: string;
}

interface VisionProfile {
  name: string;
  bio: string;
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
// Fixed virtual canvas the goal bubbles live on. Big enough that the spiral
// below has room to grow outward from the center in every direction.
const CANVAS_SIZE = 3000;
const CENTER = CANVAS_SIZE / 2;
const HOME_DIAM = 150;
const HOME_RADIUS = HOME_DIAM / 2;
const GOLDEN_ANGLE = 137.50776 * (Math.PI / 180);
const MIN_ZOOM = 0.2;
const MAX_ZOOM = 3;
const MIN_SIZE = 0.5;
const MAX_SIZE = 2.5;

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

const AddGoalPanel: FC<{ children: React.ReactNode; style?: React.CSSProperties }> = ({ children, style }) => (
  <div style={{
    background: '#fff', borderRadius: 20, padding: '1.5rem',
    boxShadow: '0 10px 18px rgba(26,26,46,0.12)', marginBottom: '1.5rem', ...style,
  }}>
    {children}
  </div>
);

const ShapeToggle: FC<{ value: 'circle' | 'square'; onChange: (s: 'circle' | 'square') => void }> = ({ value, onChange }) => (
  <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.5rem' }}>
    {(['square', 'circle'] as const).map(s => (
      <button
        key={s}
        onClick={() => onChange(s)}
        style={{
          flex: 1, padding: '1.1rem 0.5rem', borderRadius: 14, cursor: 'pointer',
          fontFamily: 'Fredoka, sans-serif', fontWeight: 700, fontSize: '0.9rem',
          background: value === s ? CYAN : '#F5F8FF',
          border: `2px solid ${value === s ? CYAN : '#DCE6F5'}`,
          color: INK, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem',
        }}
      >
        <div style={{ width: 32, height: 32, borderRadius: s === 'circle' ? '50%' : 8, background: INK }} />
        {s === 'square' ? 'Square' : 'Circle'}
      </button>
    ))}
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
  position: 'relative', zIndex: 1, flex: 1, overflow: 'hidden', width: '100%',
  display: 'flex', flexDirection: 'column',
};

const addTopBtn: React.CSSProperties = {
  width: 42, height: 42, borderRadius: 10, background: CYAN, border: 'none',
  color: '#000', fontSize: '1.5rem', fontWeight: 700, cursor: 'pointer',
  display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, lineHeight: 1, flexShrink: 0,
};

// Default placement for a goal that hasn't been dragged yet (x/y still null):
// a sunflower-style spiral radiating outward from the Home circle, so new
// goals always appear "around" Home instead of stacking in a corner grid.
function defaultSlot(index: number) {
  const angle = index * GOLDEN_ANGLE;
  const radius = HOME_RADIUS + GAP * 2 + 105 * Math.sqrt(index + 1);
  const x = CENTER + radius * Math.cos(angle) - TILE / 2;
  const y = CENTER + radius * Math.sin(angle) - TILE / 2;
  return {
    x: Math.max(0, Math.min(x, CANVAS_SIZE - TILE)),
    y: Math.max(0, Math.min(y, CANVAS_SIZE - TILE)),
  };
}

const VisionBoardScreen: FC<VisionBoardScreenProps> = ({ onClose, session }) => {
  const email = session?.email ?? null;
  const [items, setItems] = useState<VisionItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [projectName, setProjectName] = useState('');
  const [projectNotes, setProjectNotes] = useState('');
  const [projectShape, setProjectShape] = useState<'circle' | 'square'>('square');
  const [imageUrl, setImageUrl] = useState('');
  const [pendingImage, setPendingImage] = useState<{ dataBase64: string; contentType: string; previewUrl: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState('');
  const [showAdd, setShowAdd] = useState(false);
  const [editItem, setEditItem] = useState<VisionItem | null>(null);
  const [editName, setEditName] = useState('');
  const [editNotes, setEditNotes] = useState('');
  const [editShape, setEditShape] = useState<'circle' | 'square'>('square');
  const [savingEdit, setSavingEdit] = useState(false);
  const [profile, setProfile] = useState<VisionProfile | null>(null);
  const [showHome, setShowHome] = useState(false);
  const [homeName, setHomeName] = useState('');
  const [homeBio, setHomeBio] = useState('');
  const [savingHome, setSavingHome] = useState(false);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number; latestX: number; latestY: number; moved: boolean } | null>(null);
  const resizeState = useRef<{ id: string; startX: number; startY: number; startSize: number; latestSize: number; moved: boolean } | null>(null);
  // Tiles are moved/scaled by direct DOM writes during a gesture (one rAF per
  // frame) and committed to React state once on release — going through
  // setItems on every pointer move re-renders the whole board and lags.
  const tileRefs = useRef(new Map<string, HTMLDivElement>());
  const dragFrame = useRef(0);
  const resizeFrame = useRef(0);
  const panState = useRef<{ pointerId: number; startX: number; startY: number; startPanX: number; startPanY: number } | null>(null);
  const initializedPan = useRef(false);
  const panRef = useRef(pan);
  const zoomRef = useRef(zoom);
  panRef.current = pan;
  zoomRef.current = zoom;
  const activePointers = useRef(new Map<number, { x: number; y: number }>());
  const pinchState = useRef<{ dist: number; zoom: number; canvasX: number; canvasY: number } | null>(null);

  const loadItems = useCallback(async () => {
    if (!email) return;
    setLoading(true); setError('');
    try {
      const d = await callApi(VISION_API, { action: 'list-items', email });
      setItems(d.items ?? []);
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  }, [email]);

  const loadProfile = useCallback(async () => {
    if (!email) return;
    try {
      const d = await callApi(VISION_API, { action: 'get-profile', email });
      setProfile(d.profile ?? null);
    } catch { /* non-fatal, Home just shows the placeholder */ }
  }, [email]);

  useEffect(() => { loadItems(); }, [loadItems]);
  useEffect(() => { loadProfile(); }, [loadProfile]);

  const positions = useMemo(() => {
    const map = new Map<string, { x: number; y: number }>();
    let fallbackIndex = 0;
    for (const item of items) {
      if (item.x != null && item.y != null) {
        map.set(item.id, { x: item.x, y: item.y });
      } else {
        map.set(item.id, defaultSlot(fallbackIndex));
        fallbackIndex++;
      }
    }
    return map;
  }, [items]);

  // Center the Home circle (canvas center) on the viewport's own center,
  // once, the first time we know the viewport's real size.
  useEffect(() => {
    if (initializedPan.current || loading) return;
    const el = canvasRef.current;
    if (!el || el.clientWidth === 0) return;
    initializedPan.current = true;
    setPan({ x: el.clientWidth / 2 - CENTER, y: el.clientHeight / 2 - CENTER });
  }, [loading]);

  // Obsidian-style zoom: the mouse wheel (and ctrl+wheel / trackpad pinch)
  // zooms the board toward the cursor instead of scrolling. Attached natively
  // (non-passive) because React's onWheel can't reliably preventDefault.
  useEffect(() => {
    if (loading) return;
    const el = canvasRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const z = zoomRef.current;
      const p = panRef.current;
      const nz = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z * Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015))));
      // Keep the canvas point under the cursor fixed while the scale changes.
      setPan({ x: cx - ((cx - p.x) / z) * nz, y: cy - ((cy - p.y) / z) * nz });
      setZoom(nz);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [loading]);

  // Single-finger drag pans the board; a second finger turns the gesture into
  // a pinch zoom anchored at the midpoint. Home lives on the pannable layer,
  // so it pans and zooms together with the project bubbles.
  const onViewportPointerDown = (e: React.PointerEvent) => {
    activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    if (activePointers.current.size === 2) {
      panState.current = null;
      const [a, b] = [...activePointers.current.values()];
      const rect = e.currentTarget.getBoundingClientRect();
      const midX = (a.x + b.x) / 2 - rect.left;
      const midY = (a.y + b.y) / 2 - rect.top;
      pinchState.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        zoom,
        canvasX: (midX - pan.x) / zoom,
        canvasY: (midY - pan.y) / zoom,
      };
      return;
    }
    if (dragState.current || panState.current) return;
    panState.current = { pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, startPanX: pan.x, startPanY: pan.y };
  };

  const onViewportPointerMove = (e: React.PointerEvent) => {
    if (activePointers.current.has(e.pointerId)) {
      activePointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    const pinch = pinchState.current;
    if (pinch && activePointers.current.size >= 2) {
      const [a, b] = [...activePointers.current.values()];
      const rect = e.currentTarget.getBoundingClientRect();
      const midX = (a.x + b.x) / 2 - rect.left;
      const midY = (a.y + b.y) / 2 - rect.top;
      const nz = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, pinch.zoom * (Math.hypot(a.x - b.x, a.y - b.y) / pinch.dist)));
      setZoom(nz);
      setPan({ x: midX - pinch.canvasX * nz, y: midY - pinch.canvasY * nz });
      return;
    }
    const drag = panState.current;
    if (drag && drag.pointerId === e.pointerId) {
      setPan({ x: drag.startPanX + (e.clientX - drag.startX), y: drag.startPanY + (e.clientY - drag.startY) });
    }
  };

  const onViewportPointerUp = (e: React.PointerEvent) => {
    activePointers.current.delete(e.pointerId);
    if (activePointers.current.size < 2) pinchState.current = null;
    if (panState.current?.pointerId === e.pointerId) panState.current = null;
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

  const resetAddForm = () => {
    setProjectName(''); setProjectNotes(''); setProjectShape('square');
    setImageUrl(''); setPendingImage(null);
  };

  const onFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    try {
      const dataBase64 = await fileToBase64(file);
      setImageUrl('');
      setPendingImage({ dataBase64, contentType: file.type, previewUrl: URL.createObjectURL(file) });
    } catch (err) { setError(String(err)); }
  };

  const submitProject = async () => {
    const name = projectName.trim();
    if (!name) { setError('Give your project a name.'); return; }
    setAdding(true); setError('');
    try {
      const hasImage = !!pendingImage || !!imageUrl.trim();
      if (hasImage) {
        await callApi(VISION_API, {
          action: 'add-image', email, name, notes: projectNotes.trim(), shape: projectShape,
          ...(pendingImage
            ? { dataBase64: pendingImage.dataBase64, contentType: pendingImage.contentType }
            : { imageUrl: imageUrl.trim() }),
        });
      } else {
        await callApi(VISION_API, { action: 'add-text', email, text: name, name, notes: projectNotes.trim(), shape: projectShape });
      }
      resetAddForm();
      setShowAdd(false);
      loadItems();
    } catch (e) { setError(String(e)); } finally { setAdding(false); }
  };

  const openEdit = (item: VisionItem) => {
    setEditItem(item);
    setEditName(item.name || (item.kind === 'text' ? item.content : ''));
    setEditNotes(item.notes ?? '');
    setEditShape(item.shape === 'circle' ? 'circle' : 'square');
    setError('');
  };

  const saveEdit = async () => {
    if (!editItem) return;
    const name = editName.trim();
    if (!name) { setError('Give your project a name.'); return; }
    setSavingEdit(true); setError('');
    try {
      const d = await callApi(VISION_API, {
        action: 'update-item', email, id: editItem.id,
        name, notes: editNotes.trim(), shape: editShape,
      });
      const updated = d.item ?? { name, notes: editNotes.trim(), shape: editShape };
      setItems(prev => prev.map(i => i.id === editItem.id ? { ...i, ...updated } : i));
      setEditItem(null);
    } catch (e) { setError(String(e)); } finally { setSavingEdit(false); }
  };

  const deleteItem = async (item: VisionItem) => {
    if (!window.confirm('Remove this from your vision board?')) return;
    try {
      await callApi(VISION_API, { action: 'delete-item', email, id: item.id });
      setItems(prev => prev.filter(i => i.id !== item.id));
    } catch (e) { setError(String(e)); }
  };

  const openHomeEdit = () => {
    setHomeName(profile?.name ?? '');
    setHomeBio(profile?.bio ?? '');
    setShowHome(true);
  };

  const saveHome = async () => {
    setSavingHome(true); setError('');
    try {
      const d = await callApi(VISION_API, { action: 'save-profile', email, name: homeName.trim(), bio: homeBio.trim() });
      setProfile(d.profile ?? { name: homeName.trim(), bio: homeBio.trim() });
      setShowHome(false);
    } catch (e) { setError(String(e)); } finally { setSavingHome(false); }
  };

  const clampPos = (v: number, tilePx: number) => Math.max(0, Math.min(v, CANVAS_SIZE - tilePx));

  const onTilePointerDown = (e: React.PointerEvent, item: VisionItem) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.stopPropagation();
    const pos = positions.get(item.id)!;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragState.current = { id: item.id, startX: e.clientX, startY: e.clientY, origX: pos.x, origY: pos.y, latestX: pos.x, latestY: pos.y, moved: false };
  };

  const onTilePointerMove = (e: React.PointerEvent, item: VisionItem) => {
    const drag = dragState.current;
    if (!drag || drag.id !== item.id) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    drag.moved = true;
    const tilePx = TILE * (item.size ?? 1);
    // Pointer deltas are in screen pixels; convert to canvas units when zoomed.
    drag.latestX = clampPos(drag.origX + dx / zoom, tilePx);
    drag.latestY = clampPos(drag.origY + dy / zoom, tilePx);
    if (!dragFrame.current) {
      dragFrame.current = requestAnimationFrame(() => {
        dragFrame.current = 0;
        const live = dragState.current;
        if (!live || live.id !== drag.id) return;
        const el = tileRefs.current.get(live.id);
        if (!el) return;
        el.style.left = `${live.latestX}px`;
        el.style.top = `${live.latestY}px`;
      });
    }
  };

  const onTilePointerUp = async (e: React.PointerEvent, item: VisionItem) => {
    const drag = dragState.current;
    dragState.current = null;
    if (dragFrame.current) { cancelAnimationFrame(dragFrame.current); dragFrame.current = 0; }
    if (!drag || drag.id !== item.id) return;
    // A press that never turned into a drag is a tap: open the project editor.
    if (!drag.moved) { openEdit(item); return; }
    const el = tileRefs.current.get(item.id);
    if (el) { el.style.left = `${drag.latestX}px`; el.style.top = `${drag.latestY}px`; }
    const nx = drag.latestX;
    const ny = drag.latestY;
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, x: nx, y: ny } : i));
    try {
      await callApi(VISION_API, { action: 'move-item', email, id: item.id, x: nx, y: ny });
    } catch (err) { setError(String(err)); }
  };

  // A cancelled gesture (browser took over the pointer) must not count as a tap.
  const onTilePointerCancel = () => {
    const drag = dragState.current;
    dragState.current = null;
    if (dragFrame.current) { cancelAnimationFrame(dragFrame.current); dragFrame.current = 0; }
    if (drag) {
      // Put the tile back where the gesture started; nothing was saved.
      const el = tileRefs.current.get(drag.id);
      if (el) { el.style.left = `${drag.origX}px`; el.style.top = `${drag.origY}px`; }
    }
  };

  const onResizePointerDown = (e: React.PointerEvent, item: VisionItem) => {
    if (e.button !== undefined && e.button !== 0) return;
    e.stopPropagation();
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    resizeState.current = { id: item.id, startX: e.clientX, startY: e.clientY, startSize: item.size ?? 1, latestSize: item.size ?? 1, moved: false };
  };

  const onResizePointerMove = (e: React.PointerEvent, item: VisionItem) => {
    const rs = resizeState.current;
    if (!rs || rs.id !== item.id) return;
    const dx = (e.clientX - rs.startX) / zoom;
    const dy = (e.clientY - rs.startY) / zoom;
    if (!rs.moved && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
    rs.moved = true;
    const delta = Math.max(dx, dy);
    rs.latestSize = Math.max(MIN_SIZE, Math.min(MAX_SIZE, rs.startSize + delta / TILE));
    if (!resizeFrame.current) {
      resizeFrame.current = requestAnimationFrame(() => {
        resizeFrame.current = 0;
        const live = resizeState.current;
        if (!live || live.id !== rs.id) return;
        const el = tileRefs.current.get(live.id);
        if (!el) return;
        // Compositor-only scale while the finger is down; the real width and
        // height are applied once, on release.
        el.style.transformOrigin = '0 0';
        el.style.transform = `scale(${live.latestSize / live.startSize})`;
      });
    }
  };

  const onResizePointerUp = async (e: React.PointerEvent, item: VisionItem) => {
    const rs = resizeState.current;
    resizeState.current = null;
    if (resizeFrame.current) { cancelAnimationFrame(resizeFrame.current); resizeFrame.current = 0; }
    if (!rs || rs.id !== item.id) return;
    const el = tileRefs.current.get(item.id);
    if (el) el.style.transform = '';
    if (!rs.moved) return;
    const finalSize = rs.latestSize;
    setItems(prev => prev.map(i => i.id === item.id ? { ...i, size: finalSize } : i));
    try {
      await callApi(VISION_API, { action: 'resize-item', email, id: item.id, size: finalSize });
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
          <button onClick={() => setShowAdd(true)} title="Add a project" style={addTopBtn}>+</button>
        </div>
      </div>
      <div style={scrollArea}>
        {error && <div style={{ color: RED, fontSize: '0.9rem', padding: '0 1.25rem', marginBottom: '0.75rem' }}>{error}</div>}
        {loading && <div style={{ color: '#8892A6', textAlign: 'center', padding: '2rem 0' }}>Loading...</div>}

        {!loading && (
          <div
            ref={canvasRef}
            onPointerDown={onViewportPointerDown}
            onPointerMove={onViewportPointerMove}
            onPointerUp={onViewportPointerUp}
            onPointerCancel={onViewportPointerUp}
            style={{
              position: 'relative', width: '100%', flex: 1, overflow: 'hidden',
              touchAction: 'none', background: '#FFFFFF',
            }}
          >
            <div
              style={{
                position: 'absolute', left: 0, top: 0, width: CANVAS_SIZE, height: CANVAS_SIZE,
                transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`, transformOrigin: '0 0',
              }}
            >
              {items.map((item, i) => {
                const pos = positions.get(item.id) ?? { x: 0, y: 0 };
                const tilePx = TILE * (item.size ?? 1);
                const radius = item.shape === 'circle' ? '50%' : 14;
                const label = item.name || (item.kind === 'text' ? item.content : '');
                return (
                  <div
                    key={item.id}
                    ref={el => {
                      if (el) tileRefs.current.set(item.id, el);
                      else tileRefs.current.delete(item.id);
                    }}
                    onPointerDown={e => onTilePointerDown(e, item)}
                    onPointerMove={e => onTilePointerMove(e, item)}
                    onPointerUp={e => onTilePointerUp(e, item)}
                    onPointerCancel={onTilePointerCancel}
                    style={{
                      position: 'absolute', left: pos.x, top: pos.y, width: tilePx, height: tilePx,
                      borderRadius: radius, overflow: 'hidden', cursor: 'grab', touchAction: 'none',
                      userSelect: 'none', boxShadow: '0 4px 14px rgba(26,26,46,0.18)',
                    }}
                  >
                    {item.kind === 'image' ? (
                      <>
                        <img src={item.content} alt="" draggable={false} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block', pointerEvents: 'none' }} />
                        {label && (
                          <div style={{
                            position: 'absolute', left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)',
                            color: '#fff', fontWeight: 700, fontSize: '0.75rem', padding: '0.4rem 0.6rem',
                            textAlign: 'center', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            pointerEvents: 'none',
                          }}>
                            {label}
                          </div>
                        )}
                      </>
                    ) : (
                      <div style={{
                        width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                        background: '#0a0a0a', border: `2px solid ${CARD_COLORS[i % CARD_COLORS.length]}`,
                        padding: '1rem', boxSizing: 'border-box', textAlign: 'center', pointerEvents: 'none',
                      }}>
                        <span style={{ color: '#fff', fontWeight: 700, fontSize: '0.9rem', lineHeight: 1.3 }}>{label}</span>
                        {item.notes && (
                          <span style={{ color: '#aaa', fontSize: '0.72rem', marginTop: '0.4rem', lineHeight: 1.2 }}>
                            {item.notes.length > 60 ? `${item.notes.slice(0, 60)}…` : item.notes}
                          </span>
                        )}
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
                    <div
                      onPointerDown={e => onResizePointerDown(e, item)}
                      onPointerMove={e => onResizePointerMove(e, item)}
                      onPointerUp={e => onResizePointerUp(e, item)}
                      onPointerCancel={e => onResizePointerUp(e, item)}
                      title="Drag to resize"
                      style={{
                        position: 'absolute', bottom: 6, right: 6, width: 22, height: 22, borderRadius: 6,
                        background: 'rgba(0,0,0,0.7)', border: `1px solid ${CYAN}`, cursor: 'nwse-resize',
                        touchAction: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                        <path d="M9 1L1 9M9 5.5L5.5 9M9 9H9" stroke={CYAN} strokeWidth="1.4" strokeLinecap="round" />
                      </svg>
                    </div>
                  </div>
                );
              })}

              {items.length === 0 && (
                <div style={{
                  position: 'absolute', left: CENTER, top: CENTER + HOME_RADIUS + 24, transform: 'translateX(-50%)',
                  color: '#8892A6', textAlign: 'center', pointerEvents: 'none', whiteSpace: 'nowrap',
                }}>
                  Tap + to add a project or image.
                </div>
              )}

              <button
                onPointerDown={e => e.stopPropagation()}
                onClick={openHomeEdit}
                title="Edit your name & bio"
                style={{
                  position: 'absolute', left: CENTER - HOME_RADIUS, top: CENTER - HOME_RADIUS,
                  width: HOME_DIAM, height: HOME_DIAM, borderRadius: '50%', background: MAG, border: 'none',
                  display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', boxShadow: '0 8px 22px rgba(250,0,255,0.4)', padding: '0.75rem', boxSizing: 'border-box',
                  zIndex: 2,
                }}
              >
                <span style={{ color: '#fff', fontWeight: 700, fontSize: profile?.name ? '1.05rem' : '1.2rem', lineHeight: 1.15 }}>
                  {profile?.name || 'HOME'}
                </span>
                {profile?.bio && (
                  <span style={{ color: '#fff', opacity: 0.9, fontSize: '0.72rem', marginTop: '0.3rem', lineHeight: 1.2 }}>
                    {profile.bio.length > 46 ? `${profile.bio.slice(0, 46)}…` : profile.bio}
                  </span>
                )}
              </button>
            </div>
          </div>
        )}
      </div>

      {showAdd && (
        <div style={{
          position: 'fixed', inset: 0, background: MAG, zIndex: 1200,
          display: 'flex', flexDirection: 'column', fontFamily: 'Fredoka, sans-serif',
        }}>
          <div style={{ padding: '1.25rem 1.25rem 0', maxWidth: 480, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
            <BackBtn onClick={() => { setShowAdd(false); resetAddForm(); }} />
          </div>
          <div style={{ flex: 1, overflowY: 'auto', maxWidth: 480, margin: '0 auto', width: '100%', padding: '1rem 1.25rem 2rem', boxSizing: 'border-box' }}>
            <AddGoalPanel>
              <div style={fieldLabel}>Project name</div>
              <textarea
                value={projectName}
                onChange={e => setProjectName(e.target.value)}
                rows={2}
                placeholder="e.g. Launch my business by December"
                style={{ ...inputStyle, marginBottom: '1.1rem' }}
              />

              <div style={fieldLabel}>Notes</div>
              <textarea
                value={projectNotes}
                onChange={e => setProjectNotes(e.target.value)}
                rows={3}
                placeholder="Any notes for this project..."
                style={{ ...inputStyle, marginBottom: '1.1rem' }}
              />

              <div style={fieldLabel}>Add an image (optional)</div>
              <input
                value={imageUrl}
                onChange={e => { setImageUrl(e.target.value); setPendingImage(null); }}
                placeholder="Paste an image URL..."
                style={{ ...inputStyle, marginBottom: '0.75rem' }}
                disabled={!!pendingImage}
              />
              {pendingImage ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.1rem' }}>
                  <img src={pendingImage.previewUrl} alt="" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 10 }} />
                  <span style={{ color: '#8892A6', fontSize: '0.85rem', flex: 1 }}>Image ready to add</span>
                  <button style={btnGhost} onClick={() => setPendingImage(null)}>Remove</button>
                </div>
              ) : (
                <button style={{ ...btnGhost, width: '100%', marginBottom: '1.1rem' }} onClick={() => fileInputRef.current?.click()} disabled={adding || !!imageUrl.trim()}>
                  Upload Image
                </button>
              )}
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={onFilePicked} style={{ display: 'none' }} />

              <div style={fieldLabel}>Shape on the vision board</div>
              <ShapeToggle value={projectShape} onChange={setProjectShape} />

              <button style={{ ...btnCyan, width: '100%' }} onClick={submitProject} disabled={adding || !projectName.trim()}>
                {adding ? 'Adding...' : '+ Add Project'}
              </button>
            </AddGoalPanel>
            {error && <div style={{ color: '#000', fontWeight: 700, fontSize: '0.9rem' }}>{error}</div>}
          </div>
        </div>
      )}

      {editItem && (
        <div style={{
          position: 'fixed', inset: 0, background: MAG, zIndex: 1200,
          display: 'flex', flexDirection: 'column', fontFamily: 'Fredoka, sans-serif',
        }}>
          <div style={{ padding: '1.25rem 1.25rem 0', maxWidth: 480, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
            <BackBtn onClick={() => setEditItem(null)} />
          </div>
          <div style={{ flex: 1, overflowY: 'auto', maxWidth: 480, margin: '0 auto', width: '100%', padding: '1rem 1.25rem 2rem', boxSizing: 'border-box' }}>
            <AddGoalPanel>
              {editItem.kind === 'image' && (
                <img
                  src={editItem.content}
                  alt=""
                  style={{
                    width: 96, height: 96, objectFit: 'cover', display: 'block',
                    borderRadius: editShape === 'circle' ? '50%' : 14, margin: '0 auto 1.1rem',
                  }}
                />
              )}
              <div style={fieldLabel}>Project name</div>
              <textarea
                value={editName}
                onChange={e => setEditName(e.target.value)}
                rows={2}
                style={{ ...inputStyle, marginBottom: '1.1rem' }}
              />

              <div style={fieldLabel}>Notes</div>
              <textarea
                value={editNotes}
                onChange={e => setEditNotes(e.target.value)}
                rows={3}
                placeholder="Any notes for this project..."
                style={{ ...inputStyle, marginBottom: '1.1rem' }}
              />

              <div style={fieldLabel}>Shape on the vision board</div>
              <ShapeToggle value={editShape} onChange={setEditShape} />

              <button style={{ ...btnCyan, width: '100%' }} onClick={saveEdit} disabled={savingEdit || !editName.trim()}>
                {savingEdit ? 'Saving...' : 'Save'}
              </button>
            </AddGoalPanel>
            {error && <div style={{ color: '#000', fontWeight: 700, fontSize: '0.9rem' }}>{error}</div>}
          </div>
        </div>
      )}

      {showHome && (
        <div style={{
          position: 'fixed', inset: 0, background: MAG, zIndex: 1200,
          display: 'flex', flexDirection: 'column', fontFamily: 'Fredoka, sans-serif',
        }}>
          <div style={{ padding: '1.25rem 1.25rem 0', maxWidth: 480, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
            <BackBtn onClick={() => setShowHome(false)} />
          </div>
          <div style={{ flex: 1, overflowY: 'auto', maxWidth: 480, margin: '0 auto', width: '100%', padding: '1rem 1.25rem 2rem', boxSizing: 'border-box' }}>
            <AddGoalPanel>
              <div style={fieldLabel}>Your name</div>
              <input
                value={homeName}
                onChange={e => setHomeName(e.target.value)}
                placeholder="e.g. Dian"
                style={{ ...inputStyle, marginBottom: '0.75rem' }}
              />
              <div style={fieldLabel}>Little bio</div>
              <textarea
                value={homeBio}
                onChange={e => setHomeBio(e.target.value)}
                rows={3}
                placeholder="A few words about you..."
                style={{ ...inputStyle, marginBottom: '1.1rem' }}
              />
              <button style={{ ...btnCyan, width: '100%' }} onClick={saveHome} disabled={savingHome}>
                {savingHome ? 'Saving...' : 'Save'}
              </button>
            </AddGoalPanel>
            {error && <div style={{ color: '#000', fontWeight: 700, fontSize: '0.9rem' }}>{error}</div>}
          </div>
        </div>
      )}
    </div>
  );
};

export default VisionBoardScreen;
