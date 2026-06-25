import { FC, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';

interface Props {
  session: any;
  onClose: () => void;
}

interface Profile {
  email: string;
  full_name: string;
  avatar_url: string;
  bio: string;
  subscription_tier: string;
  subscription_status: string;
}

const CYAN = '#00F7FF';
const MAGENTA = '#FA00FF';

const tierColor = (tier: string): string => {
  if (tier === 'max') return CYAN;
  if (tier === 'mini') return MAGENTA;
  return '#FFFFFF';
};

const NaviProfile: FC<Props> = ({ session, onClose }) => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [profile, setProfile] = useState<Profile>({
    email: '',
    full_name: '',
    avatar_url: '',
    bio: '',
    subscription_tier: 'free',
    subscription_status: '',
  });

  const [authId, setAuthId] = useState<string | undefined>(session?.user?.id);
  const [resolving, setResolving] = useState(true);

  // Resolve the Supabase auth uuid. Prefer the id on the passed session;
  // otherwise ask the live Supabase client (App only stores email + token).
  useEffect(() => {
    let active = true;
    if (session?.user?.id) {
      setAuthId(session.user.id);
      setResolving(false);
      return;
    }
    (async () => {
      try {
        const { data } = await supabase.auth.getUser();
        if (active) setAuthId(data?.user?.id);
      } catch {
        /* no-op */
      } finally {
        if (active) setResolving(false);
      }
    })();
    return () => { active = false; };
  }, [session]);

  useEffect(() => {
    let active = true;
    if (resolving) return;
    if (!authId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    (async () => {
      try {
        const { data, error: err } = await supabase
          .from('profiles')
          .select('email, full_name, avatar_url, bio, subscription_tier, subscription_status')
          .eq('auth_id', authId)
          .single();
        if (!active) return;
        if (err) {
          setError('Could not load your profile right now.');
        } else if (data) {
          setProfile({
            email: data.email ?? session?.user?.email ?? '',
            full_name: data.full_name ?? '',
            avatar_url: data.avatar_url ?? '',
            bio: data.bio ?? '',
            subscription_tier: data.subscription_tier ?? 'free',
            subscription_status: data.subscription_status ?? '',
          });
        }
      } catch {
        if (active) setError('Could not load your profile right now.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [authId, resolving]);

  const save = async () => {
    if (!authId) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const { error: err } = await supabase
        .from('profiles')
        .update({
          full_name: profile.full_name,
          avatar_url: profile.avatar_url,
          bio: profile.bio,
        })
        .eq('auth_id', authId);
      if (err) {
        setError('Could not save your changes. Please try again.');
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2500);
      }
    } catch {
      setError('Could not save your changes. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // Sign the user out. App.tsx's onAuthStateChange fires on signOut and clears
  // the session state for the whole app; we just close this overlay afterwards.
  const signOut = async () => {
    setSigningOut(true);
    try {
      await supabase.auth.signOut();
    } catch {
      /* even if the network call fails, close the overlay */
    } finally {
      setSigningOut(false);
      onClose();
    }
  };

  const labelStyle: React.CSSProperties = {
    color: CYAN,
    fontSize: '0.85rem',
    fontWeight: 600,
    marginBottom: '0.4rem',
    display: 'block',
  };

  const inputStyle: React.CSSProperties = {
    width: '100%',
    boxSizing: 'border-box',
    background: '#111',
    border: '1px solid #222',
    borderRadius: '12px',
    color: '#e8e8e8',
    padding: '0.75rem 0.95rem',
    fontFamily: 'Fredoka, sans-serif',
    fontSize: '1rem',
    outline: 'none',
  };

  const fieldWrap: React.CSSProperties = { marginBottom: '1.35rem' };

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: '#000',
      zIndex: 999,
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'Fredoka, sans-serif',
      overflowY: 'auto',
    }}>

      {/* Back button */}
      <div style={{ padding: '1.25rem 1.25rem 0', maxWidth: '480px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        <button onClick={onClose} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <div style={{ width: '42px', height: '42px', background: CYAN, borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
              <path d="M17 7H1M7 1L1 7l6 6" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </button>
      </div>

      {/* Content */}
      <div style={{
        maxWidth: '480px',
        margin: '0 auto',
        width: '100%',
        padding: '1.5rem 2rem 3rem',
        boxSizing: 'border-box',
      }}>
        <h1 style={{ color: CYAN, fontSize: '2.4rem', fontWeight: 700, margin: '0.5rem 0 1.75rem' }}>My Profile</h1>

        {!resolving && !authId && (
          <div style={{ color: '#cfcfcf', fontSize: '1.05rem', lineHeight: 1.6 }}>
            Sign in to view your profile.
            <div style={{ color: '#777', fontSize: '0.9rem', marginTop: '0.6rem' }}>
              Once you're signed in, your details and subscription will show up here.
            </div>
          </div>
        )}

        {(resolving || (authId && loading)) && (
          <div style={{ color: '#777', fontSize: '1rem' }}>Loading your profile…</div>
        )}

        {!resolving && authId && !loading && (
          <>
            {/* Avatar preview */}
            {profile.avatar_url.trim() !== '' && (
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem' }}>
                <img
                  src={profile.avatar_url}
                  alt="Avatar"
                  style={{ width: '96px', height: '96px', borderRadius: '9999px', objectFit: 'cover', border: `2px solid ${CYAN}` }}
                  onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                />
              </div>
            )}

            {/* Subscription badge */}
            <div style={{ marginBottom: '1.5rem', display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
              <span style={{
                display: 'inline-block',
                background: tierColor(profile.subscription_tier),
                color: '#000',
                fontWeight: 700,
                fontSize: '0.85rem',
                padding: '0.35rem 0.85rem',
                borderRadius: '100px',
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
              }}>
                {profile.subscription_tier || 'free'}
              </span>
              {profile.subscription_status && (
                <span style={{ color: '#999', fontSize: '0.85rem' }}>
                  {profile.subscription_status}
                </span>
              )}
            </div>

            {/* Email (read-only) */}
            <div style={fieldWrap}>
              <label style={labelStyle}>Email</label>
              <input
                type="email"
                value={profile.email}
                readOnly
                style={{ ...inputStyle, color: '#888', cursor: 'default' }}
              />
            </div>

            {/* Full name */}
            <div style={fieldWrap}>
              <label style={labelStyle}>Full name</label>
              <input
                type="text"
                value={profile.full_name}
                onChange={(e) => setProfile(p => ({ ...p, full_name: e.target.value }))}
                placeholder="Your name"
                style={inputStyle}
              />
            </div>

            {/* Avatar URL */}
            <div style={fieldWrap}>
              <label style={labelStyle}>Avatar URL</label>
              <input
                type="text"
                value={profile.avatar_url}
                onChange={(e) => setProfile(p => ({ ...p, avatar_url: e.target.value }))}
                placeholder="https://…"
                style={inputStyle}
              />
            </div>

            {/* Bio */}
            <div style={fieldWrap}>
              <label style={labelStyle}>Bio</label>
              <textarea
                value={profile.bio}
                onChange={(e) => setProfile(p => ({ ...p, bio: e.target.value }))}
                placeholder="Tell NAVI a little about yourself"
                rows={4}
                style={{ ...inputStyle, resize: 'vertical', minHeight: '90px', lineHeight: 1.5 }}
              />
            </div>

            {error && (
              <div style={{ color: MAGENTA, fontSize: '0.9rem', marginBottom: '1rem' }}>{error}</div>
            )}

            {/* Save */}
            <button
              onClick={save}
              disabled={saving}
              style={{
                width: '100%',
                background: CYAN,
                color: '#000',
                border: 'none',
                borderRadius: '12px',
                padding: '0.9rem',
                fontFamily: 'Fredoka, sans-serif',
                fontSize: '1.05rem',
                fontWeight: 700,
                cursor: saving ? 'not-allowed' : 'pointer',
                opacity: saving ? 0.6 : 1,
                transition: 'opacity 0.15s',
              }}
            >
              {saving ? 'Saving…' : saved ? 'Saved ✓' : 'Save'}
            </button>

            {/* Sign Out — clears the Supabase session; App.tsx reacts via onAuthStateChange */}
            <button
              onClick={signOut}
              disabled={signingOut}
              style={{
                width: '100%',
                marginTop: '0.85rem',
                background: 'transparent',
                color: MAGENTA,
                border: `1px solid ${MAGENTA}`,
                borderRadius: '12px',
                padding: '0.9rem',
                fontFamily: 'Fredoka, sans-serif',
                fontSize: '1.05rem',
                fontWeight: 700,
                cursor: signingOut ? 'not-allowed' : 'pointer',
                opacity: signingOut ? 0.6 : 1,
                transition: 'opacity 0.15s',
              }}
            >
              {signingOut ? 'Signing out…' : 'Sign Out'}
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default NaviProfile;
