import { useState } from 'react';
import { sendMagicLink, storeSession, getSubscriptionStatus, NaviSession } from '../lib/navi-supabase';

interface NaviSubscribeProps {
  mode: 'mini' | 'max';
  onAuthenticated: (session: NaviSession) => void;
  onClose: () => void;
}

type Step = 'email' | 'sent' | 'subscribe';

export default function NaviSubscribe({ mode, onAuthenticated, onClose }: NaviSubscribeProps) {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const price = mode === 'mini' ? '$10' : '$20';
  const compute = mode === 'mini' ? '$5' : '$10';
  const accent = mode === 'mini' ? '#FA00FF' : '#00F7FF';
  const label = mode === 'mini' ? 'NAVI Mini' : 'NAVI Max';

  async function handleEmail() {
    if (!email.trim()) return;
    setLoading(true);
    setError('');
    const { error: err } = await sendMagicLink(email.trim());
    setLoading(false);
    if (err) { setError(err); return; }

    // Check if already subscribed
    const sub = await getSubscriptionStatus(email.trim());
    if (sub.active && (sub.tier === mode || (mode === 'mini' && sub.tier === 'max'))) {
      const session: NaviSession = { email: email.trim(), access_token: '' };
      storeSession(session);
      onAuthenticated(session);
    } else {
      setStep('sent');
    }
  }

  const overlayStyle: React.CSSProperties = {
    position: 'fixed', inset: 0, background: '#000',
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    zIndex: 100, fontFamily: 'Fredoka, sans-serif', padding: '24px',
  };

  const cardStyle: React.CSSProperties = {
    width: '100%', maxWidth: '400px', background: '#0a0a0a',
    border: `1.5px solid ${accent}`, borderRadius: '16px',
    padding: '32px 24px', display: 'flex', flexDirection: 'column', gap: '20px',
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={cardStyle} onClick={(e) => e.stopPropagation()}>
        <button
          onClick={onClose}
          style={{ background: 'none', border: 'none', color: '#555', fontSize: '20px', alignSelf: 'flex-end', cursor: 'pointer', lineHeight: 1 }}
        >✕</button>

        {step === 'email' && (
          <>
            <div style={{ textAlign: 'center' }}>
              <div style={{ fontSize: '28px', fontWeight: 700, color: accent }}>{label}</div>
              <div style={{ color: '#888', fontSize: '15px', marginTop: '6px' }}>
                {price}/month · {compute} compute
              </div>
            </div>
            <div style={{ color: '#ccc', fontSize: '14px', lineHeight: 1.6, textAlign: 'center' }}>
              {mode === 'mini'
                ? 'Faster responses, smarter reasoning — perfect for daily conversations.'
                : 'Maximum intelligence, deepest context — for when you need NAVI at full power.'}
            </div>
            <input
              type="email"
              placeholder="your@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleEmail()}
              style={{
                background: '#111', border: '1.5px solid #333', borderRadius: '10px',
                color: '#fff', padding: '12px 16px', fontSize: '15px',
                fontFamily: 'Fredoka, sans-serif', outline: 'none', width: '100%',
                boxSizing: 'border-box',
              }}
            />
            {error && <div style={{ color: '#ff4444', fontSize: '13px', textAlign: 'center' }}>{error}</div>}
            <button
              onClick={handleEmail}
              disabled={loading || !email.trim()}
              style={{
                background: accent, color: '#000', border: 'none', borderRadius: '10px',
                padding: '13px', fontSize: '16px', fontWeight: 700,
                fontFamily: 'Fredoka, sans-serif', cursor: loading ? 'wait' : 'pointer',
                opacity: loading || !email.trim() ? 0.6 : 1,
              }}
            >
              {loading ? 'Sending...' : 'Continue'}
            </button>
          </>
        )}

        {step === 'sent' && (
          <>
            <div style={{ textAlign: 'center', fontSize: '24px', fontWeight: 700, color: accent }}>Check your email</div>
            <div style={{ color: '#aaa', fontSize: '14px', lineHeight: 1.7, textAlign: 'center' }}>
              We sent a link to <span style={{ color: '#fff' }}>{email}</span>.<br />
              Click it to verify, then subscribe to {label}.
            </div>
            <div style={{ background: '#111', border: '1px solid #222', borderRadius: '12px', padding: '16px', textAlign: 'center' }}>
              <div style={{ color: accent, fontWeight: 700, fontSize: '18px', marginBottom: '6px' }}>{label}</div>
              <div style={{ color: '#888', fontSize: '13px' }}>{price}/month</div>
              <div style={{ color: '#666', fontSize: '12px', marginTop: '8px' }}>
                {compute} monthly compute · Hard limit enforced
              </div>
              <div style={{ color: '#00F7FF', fontSize: '13px', marginTop: '16px' }}>
                To subscribe, email <strong>prophetdian@gmail.com</strong> with subject "{label} Subscription"
              </div>
              <div style={{ color: '#555', fontSize: '11px', marginTop: '6px' }}>
                PayPal payments coming soon
              </div>
            </div>
            <button
              onClick={onClose}
              style={{
                background: 'none', border: `1.5px solid ${accent}`, borderRadius: '10px',
                color: accent, padding: '12px', fontSize: '15px', fontWeight: 700,
                fontFamily: 'Fredoka, sans-serif', cursor: 'pointer',
              }}
            >
              Got it
            </button>
          </>
        )}
      </div>
    </div>
  );
}
