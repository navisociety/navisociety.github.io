import { FC, useEffect, useRef, useState } from 'react';

interface ShareScreenProps {
  onClose: () => void;
  session: { email: string } | null;
}

interface ConnectedAccount {
  platform: string;
  handle: string;
  connectedAt: string;
}

interface ShareMedia {
  url: string;
  contentType: string;
  name: string;
  size: number;
}

interface ShareRecord {
  id: string;
  caption: string;
  platforms: string[];
  media: ShareMedia | null;
  createdAt: string;
}

const SHARE_API = 'https://irssegzkvxyewuxgqpwi.supabase.co/functions/v1/navi-share';

const CYAN = '#00F7FF';
const RED = '#FA0000';
const INK = '#1A1A2E';
const GREY = '#8892A6';

const PLATFORMS = [
  { name: 'Instagram', color: '#E1306C', letter: 'I' },
  { name: 'TikTok', color: '#000000', letter: 'T' },
  { name: 'Facebook', color: '#1877F2', letter: 'f' },
  { name: 'YouTube', color: '#FF0000', letter: 'Y' },
  { name: 'X', color: '#000000', letter: 'X' },
];

const MAX_MEDIA_BYTES = 10 * 1024 * 1024;

async function api<T>(payload: Record<string, unknown>): Promise<T> {
  const r = await fetch(SHARE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await r.json();
  if (!r.ok || data.error) throw new Error(data.error || 'Something went wrong.');
  return data as T;
}

function fileToBase64(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result ?? '');
      resolve(s.slice(s.indexOf(',') + 1));
    };
    reader.onerror = () => reject(new Error('Could not read the file.'));
    reader.readAsDataURL(f);
  });
}

const BackBtnDark: FC<{ onClick: () => void }> = ({ onClick }) => (
  <button onClick={onClick} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0 }}>
    <div style={{ width: 42, height: 42, background: '#000', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
        <path d="M17 7H1M7 1L1 7l6 6" stroke={CYAN} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  </button>
);

const BackBtnCyan: FC<{ onClick: () => void }> = ({ onClick }) => (
  <button onClick={onClick} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0 }}>
    <div style={{ width: 42, height: 42, background: CYAN, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
        <path d="M17 7H1M7 1L1 7l6 6" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  </button>
);

const topBar: React.CSSProperties = {
  padding: '1.25rem 1.25rem 0', maxWidth: 480, margin: '0 auto',
  width: '100%', boxSizing: 'border-box',
};
const scrollArea: React.CSSProperties = {
  flex: 1, overflowY: 'auto', maxWidth: 480, margin: '0 auto',
  width: '100%', padding: '1rem 1.25rem 2rem', boxSizing: 'border-box',
};

function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${bytes} B`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return isNaN(d.getTime()) ? '' : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

const ShareScreen: FC<ShareScreenProps> = ({ onClose, session }) => {
  const email = session?.email ?? null;
  const [view, setView] = useState<'slots' | 'new' | 'history'>('slots');
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [shares, setShares] = useState<ShareRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [connecting, setConnecting] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [handle, setHandle] = useState('');
  const [error, setError] = useState('');

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [caption, setCaption] = useState('');
  const [shared, setShared] = useState(false);
  const [sharing, setSharing] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!email) return;
    let alive = true;
    setLoading(true);
    Promise.all([
      api<{ accounts: ConnectedAccount[] }>({ action: 'get-accounts', email }),
      api<{ shares: ShareRecord[] }>({ action: 'list-shares', email }),
    ])
      .then(([a, s]) => { if (alive) { setAccounts(a.accounts); setShares(s.shares); } })
      .catch(e => { if (alive) setError(String(e.message ?? e)); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [email]);

  useEffect(() => {
    return () => { if (preview) URL.revokeObjectURL(preview); };
  }, [preview]);

  if (!email) {
    return (
      <div style={{ position: 'fixed', inset: 0, background: CYAN, zIndex: 1000, display: 'flex', flexDirection: 'column', fontFamily: 'Fredoka, sans-serif' }}>
        <div style={topBar}><BackBtnDark onClick={onClose} /></div>
        <div style={{ ...scrollArea, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
          <span style={{ color: '#000', fontSize: '1.2rem', fontWeight: 700 }}>Sign in to use Share</span>
          <span style={{ color: '#000', opacity: 0.6, fontSize: '0.9rem', marginTop: '0.5rem' }}>Open the menu and sign in first.</span>
        </div>
      </div>
    );
  }

  const findAccount = (platform: string) => accounts.find(a => a.platform === platform) ?? null;

  const startConnect = (platform: string) => {
    setConnecting(platform);
    setHandle('');
    setError('');
  };

  const confirmConnect = async () => {
    if (!connecting || busy) return;
    const clean = handle.trim().replace(/^@/, '');
    if (!clean) { setError('Enter your username to connect.'); return; }
    setBusy(true);
    setError('');
    try {
      const { accounts: next } = await api<{ accounts: ConnectedAccount[] }>({ action: 'connect', email, platform: connecting, handle: clean });
      setAccounts(next);
      setConnecting(null);
      setHandle('');
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async (platform: string) => {
    if (busy || !window.confirm(`Disconnect ${platform}?`)) return;
    setBusy(true);
    setError('');
    try {
      const { accounts: next } = await api<{ accounts: ConnectedAccount[] }>({ action: 'disconnect', email, platform });
      setAccounts(next);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const pickFile = (f: File | null) => {
    if (preview) URL.revokeObjectURL(preview);
    setError('');
    if (f && f.size > MAX_MEDIA_BYTES) {
      setFile(null);
      setPreview(null);
      setError('File too large (max 10MB for now).');
      return;
    }
    if (f) {
      setFile(f);
      setPreview(URL.createObjectURL(f));
    } else {
      setFile(null);
      setPreview(null);
    }
  };

  const doShare = async () => {
    if (sharing) return;
    if (accounts.length === 0) { setError('Connect at least one account first.'); return; }
    if (!file && !caption.trim()) { setError('Add an image, video or caption to share.'); return; }
    setError('');
    setSharing(true);
    try {
      const payload: Record<string, unknown> = { action: 'create-share', email, caption: caption.trim() };
      if (file) {
        payload.dataBase64 = await fileToBase64(file);
        payload.contentType = file.type;
        payload.fileName = file.name;
      }
      const { share } = await api<{ share: ShareRecord }>(payload);
      setShares(prev => [share, ...prev]);
      setShared(true);
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setSharing(false);
    }
  };

  const deleteShare = async (id: string) => {
    if (busy || !window.confirm('Delete this share?')) return;
    setBusy(true);
    setError('');
    try {
      await api<{ ok: boolean }>({ action: 'delete-share', email, id });
      setShares(prev => prev.filter(s => s.id !== id));
    } catch (e) {
      setError(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  // --- New Share view (white) ---
  if (view === 'new') {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#FFFFFF', zIndex: 1000, display: 'flex', flexDirection: 'column', fontFamily: 'Fredoka, sans-serif' }}>
        <div style={topBar}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <BackBtnCyan onClick={() => { setView('slots'); setShared(false); setError(''); }} />
            <span style={{ color: INK, fontSize: '1.6rem', fontWeight: 700 }}>New Share</span>
          </div>
        </div>
        <div style={scrollArea}>
          {shared ? (
            <div style={{ textAlign: 'center', padding: '3rem 0' }}>
              <div style={{ width: 64, height: 64, borderRadius: '50%', background: CYAN, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 1rem' }}>
                <svg width="28" height="22" viewBox="0 0 28 22" fill="none"><path d="M2 11l8 8L26 3" stroke="#000" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </div>
              <div style={{ color: INK, fontSize: '1.2rem', fontWeight: 700 }}>Share saved</div>
              <div style={{ color: GREY, fontSize: '0.9rem', marginTop: '0.5rem', lineHeight: 1.6 }}>
                Stored at original quality and prepared for {accounts.map(a => a.platform).join(', ')}.
                <br />Find it any time under My Shares. Direct posting is coming soon.
              </div>
              <button
                onClick={() => { setShared(false); pickFile(null); setCaption(''); }}
                style={{ background: CYAN, color: '#000', border: 'none', borderRadius: 10, fontFamily: 'Fredoka, sans-serif', fontWeight: 700, fontSize: '1rem', padding: '0.85rem 1.2rem', cursor: 'pointer', marginTop: '1.5rem' }}
              >
                Make Another
              </button>
            </div>
          ) : (
            <>
              {/* Box 1: upload image / video */}
              <input
                ref={fileInput}
                type="file"
                accept="image/*,video/*"
                style={{ display: 'none' }}
                onChange={e => pickFile(e.target.files?.[0] ?? null)}
              />
              <button
                onClick={() => fileInput.current?.click()}
                style={{ width: '100%', background: '#F5F8FF', border: '2px dashed #DCE6F5', borderRadius: 14, padding: file ? '0.75rem' : '2.5rem 1rem', cursor: 'pointer', textAlign: 'center', boxSizing: 'border-box', fontFamily: 'Fredoka, sans-serif' }}
              >
                {file && preview ? (
                  <>
                    {file.type.startsWith('video/') ? (
                      <video src={preview} controls style={{ width: '100%', maxHeight: 260, borderRadius: 10, background: '#000' }} />
                    ) : (
                      <img src={preview} alt="Upload preview" style={{ width: '100%', maxHeight: 260, objectFit: 'contain', borderRadius: 10 }} />
                    )}
                    <div style={{ color: INK, fontSize: '0.85rem', fontWeight: 700, marginTop: '0.5rem', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>{file.name}</div>
                    <div style={{ color: GREY, fontSize: '0.78rem', marginTop: 2 }}>{formatSize(file.size)} · original quality kept</div>
                  </>
                ) : (
                  <>
                    <div style={{ width: 48, height: 48, borderRadius: 12, background: CYAN, display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 0.75rem' }}>
                      <svg width="20" height="20" viewBox="0 0 20 20" fill="none"><path d="M10 14V3M5 8l5-5 5 5M3 17h14" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    </div>
                    <div style={{ color: INK, fontSize: '1rem', fontWeight: 700 }}>Upload image or video</div>
                    <div style={{ color: GREY, fontSize: '0.8rem', marginTop: 4 }}>Always shared at highest quality — never compressed (max 10MB)</div>
                  </>
                )}
              </button>
              {file && (
                <button
                  onClick={() => pickFile(null)}
                  style={{ background: 'none', border: 'none', color: GREY, fontSize: '0.8rem', cursor: 'pointer', fontFamily: 'Fredoka, sans-serif', padding: '0.5rem 0', display: 'block', margin: '0 auto' }}
                >
                  Remove file
                </button>
              )}

              {/* Box 2: caption */}
              <div style={{ color: GREY, fontSize: '0.8rem', fontWeight: 700, margin: '1.1rem 0 0.5rem' }}>Caption</div>
              <textarea
                value={caption}
                onChange={e => setCaption(e.target.value)}
                rows={5}
                placeholder="Write your caption..."
                style={{ background: '#F5F8FF', border: '1px solid #DCE6F5', color: INK, borderRadius: 14, padding: '0.85rem', fontFamily: 'Fredoka, sans-serif', fontSize: '1rem', width: '100%', boxSizing: 'border-box', resize: 'vertical' }}
              />

              {error && <div style={{ color: RED, fontSize: '0.9rem', marginTop: '0.75rem' }}>{error}</div>}

              <button
                onClick={doShare}
                disabled={sharing}
                style={{ background: CYAN, color: '#000', border: 'none', borderRadius: 10, fontFamily: 'Fredoka, sans-serif', fontWeight: 700, fontSize: '1rem', padding: '0.85rem 1.2rem', cursor: sharing ? 'wait' : 'pointer', width: '100%', marginTop: '1.25rem', opacity: sharing ? 0.6 : 1 }}
              >
                {sharing ? 'Saving...' : 'Share'}
              </button>
              <div style={{ color: GREY, fontSize: '0.78rem', textAlign: 'center', marginTop: '0.6rem' }}>
                {accounts.length === 0 ? 'No accounts connected yet' : `Shares to ${accounts.length} connected account${accounts.length === 1 ? '' : 's'}`}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // --- My Shares view (white) ---
  if (view === 'history') {
    return (
      <div style={{ position: 'fixed', inset: 0, background: '#FFFFFF', zIndex: 1000, display: 'flex', flexDirection: 'column', fontFamily: 'Fredoka, sans-serif' }}>
        <div style={topBar}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <BackBtnCyan onClick={() => { setView('slots'); setError(''); }} />
            <span style={{ color: INK, fontSize: '1.6rem', fontWeight: 700 }}>My Shares</span>
          </div>
        </div>
        <div style={scrollArea}>
          {error && <div style={{ color: RED, fontSize: '0.9rem', marginBottom: '0.75rem' }}>{error}</div>}
          {shares.length === 0 ? (
            <div style={{ color: GREY, fontSize: '0.95rem', textAlign: 'center', padding: '3rem 0' }}>
              Nothing shared yet. Your saved shares will live here.
            </div>
          ) : (
            shares.map(s => (
              <div key={s.id} style={{ background: '#F5F8FF', border: '1px solid #DCE6F5', borderRadius: 14, padding: '0.85rem', marginBottom: '0.6rem' }}>
                {s.media && (
                  s.media.contentType.startsWith('video/') ? (
                    <video src={s.media.url} controls style={{ width: '100%', maxHeight: 220, borderRadius: 10, background: '#000' }} />
                  ) : (
                    <img src={s.media.url} alt={s.media.name} style={{ width: '100%', maxHeight: 220, objectFit: 'contain', borderRadius: 10 }} />
                  )
                )}
                {s.caption && (
                  <div style={{ color: INK, fontSize: '0.95rem', marginTop: s.media ? '0.6rem' : 0, whiteSpace: 'pre-wrap', overflowWrap: 'break-word' }}>{s.caption}</div>
                )}
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginTop: '0.6rem' }}>
                  <div style={{ color: GREY, fontSize: '0.75rem', flex: 1 }}>
                    {formatDate(s.createdAt)} · {s.platforms.join(', ')}
                    {s.media ? ` · ${formatSize(s.media.size)}` : ''}
                  </div>
                  <button
                    onClick={() => deleteShare(s.id)}
                    style={{ background: 'none', border: '1px solid #DCE6F5', color: RED, borderRadius: 999, fontFamily: 'Fredoka, sans-serif', fontWeight: 700, fontSize: '0.75rem', padding: '0.35rem 0.8rem', cursor: 'pointer', flexShrink: 0 }}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    );
  }

  // --- Slots view (cyan) ---
  return (
    <div style={{ position: 'fixed', inset: 0, background: CYAN, zIndex: 1000, display: 'flex', flexDirection: 'column', fontFamily: 'Fredoka, sans-serif' }}>
      <div style={topBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <BackBtnDark onClick={onClose} />
          <span style={{ color: '#000', fontSize: '1.6rem', fontWeight: 700 }}>Share</span>
        </div>
      </div>
      <div style={scrollArea}>
        <div style={{ color: '#000', opacity: 0.6, fontSize: '0.85rem', marginBottom: '1rem' }}>
          Connect your accounts to share from NAVI.
        </div>

        {loading ? (
          <div style={{ color: '#000', opacity: 0.6, fontSize: '0.95rem', textAlign: 'center', padding: '2rem 0' }}>Loading your accounts...</div>
        ) : (
          <>
            {PLATFORMS.map(p => {
              const acc = findAccount(p.name);
              const isConnecting = connecting === p.name;
              return (
                <div key={p.name} style={{ background: '#fff', borderRadius: 14, padding: '1rem', marginBottom: '0.6rem', boxShadow: '0 4px 14px rgba(0,0,0,0.08)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                    <div style={{ width: 42, height: 42, borderRadius: 12, background: p.color, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, fontSize: '1.1rem', flexShrink: 0 }}>
                      {p.letter}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ color: INK, fontWeight: 700, fontSize: '1rem' }}>{p.name}</div>
                      <div style={{ color: GREY, fontSize: '0.8rem', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis' }}>
                        {acc ? `@${acc.handle}` : 'Empty slot'}
                      </div>
                    </div>
                    {acc ? (
                      <button
                        onClick={() => disconnect(p.name)}
                        style={{ background: 'none', border: `1px solid #DCE6F5`, color: GREY, borderRadius: 999, fontFamily: 'Fredoka, sans-serif', fontWeight: 700, fontSize: '0.78rem', padding: '0.4rem 0.9rem', cursor: 'pointer', flexShrink: 0 }}
                      >
                        Disconnect
                      </button>
                    ) : (
                      <button
                        onClick={() => (isConnecting ? setConnecting(null) : startConnect(p.name))}
                        style={{ background: '#000', border: 'none', color: CYAN, borderRadius: 999, fontFamily: 'Fredoka, sans-serif', fontWeight: 700, fontSize: '0.78rem', padding: '0.4rem 0.9rem', cursor: 'pointer', flexShrink: 0 }}
                      >
                        {isConnecting ? 'Cancel' : 'Connect'}
                      </button>
                    )}
                  </div>

                  {isConnecting && (
                    <div style={{ marginTop: '0.85rem', borderTop: '1px solid #EEF3FB', paddingTop: '0.85rem' }}>
                      <div style={{ color: GREY, fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                        Log in with your {p.name} username to give NAVI permission to share to this account.
                      </div>
                      <input
                        value={handle}
                        onChange={e => setHandle(e.target.value)}
                        placeholder={`@your${p.name.toLowerCase()}`}
                        style={{ background: '#F5F8FF', border: '1px solid #DCE6F5', color: INK, borderRadius: 10, padding: '0.75rem', fontFamily: 'Fredoka, sans-serif', fontSize: '0.95rem', width: '100%', boxSizing: 'border-box', marginBottom: '0.6rem' }}
                      />
                      {error && <div style={{ color: RED, fontSize: '0.85rem', marginBottom: '0.6rem' }}>{error}</div>}
                      <button
                        onClick={confirmConnect}
                        disabled={busy}
                        style={{ background: p.color, color: '#fff', border: 'none', borderRadius: 10, fontFamily: 'Fredoka, sans-serif', fontWeight: 700, fontSize: '0.9rem', padding: '0.7rem 1rem', cursor: busy ? 'wait' : 'pointer', width: '100%', opacity: busy ? 0.6 : 1 }}
                      >
                        {busy ? 'Connecting...' : 'Give permission & connect'}
                      </button>
                    </div>
                  )}
                </div>
              );
            })}

            {error && !connecting && <div style={{ color: RED, fontSize: '0.85rem', margin: '0.4rem 0' }}>{error}</div>}

            <button
              onClick={() => { setView('new'); setShared(false); setError(''); }}
              style={{ background: '#000', color: CYAN, border: 'none', borderRadius: 10, fontFamily: 'Fredoka, sans-serif', fontWeight: 700, fontSize: '1.05rem', padding: '1rem 1.2rem', cursor: 'pointer', width: '100%', marginTop: '0.9rem' }}
            >
              New Share
            </button>
            <button
              onClick={() => { setView('history'); setError(''); }}
              style={{ background: 'none', color: '#000', border: '2px solid #000', borderRadius: 10, fontFamily: 'Fredoka, sans-serif', fontWeight: 700, fontSize: '1.05rem', padding: '0.9rem 1.2rem', cursor: 'pointer', width: '100%', marginTop: '0.6rem', boxSizing: 'border-box' }}
            >
              My Shares{shares.length > 0 ? ` (${shares.length})` : ''}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default ShareScreen;
