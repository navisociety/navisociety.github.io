import { useState, useEffect, useRef } from 'react';
import { sendMagicLink, storeSession, getSubscriptionStatus, NaviSession } from '../lib/navi-supabase';

interface NaviSubscribeProps {
  mode: 'mini' | 'max';
  onAuthenticated: (session: NaviSession) => void;
  onClose: () => void;
}

type Step = 'email' | 'upgrade' | 'success';

const PAYPAL_CLIENT_ID = 'BAA4Pfgt8NrVZMCEc4cFkY6PsxA6OnR5pJARRVhH0m5W1H5v68jYYxLYqSZMBNvny_SmwkcmTdspeAlc2Q';
const PAYPAL_FN = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/navi-paypal`;

// Load the PayPal JS SDK once
let paypalSdkPromise: Promise<void> | null = null;
function loadPayPalSdk(): Promise<void> {
  if (typeof (window as any).paypal !== 'undefined') return Promise.resolve();
  if (paypalSdkPromise) return paypalSdkPromise;
  paypalSdkPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://www.paypal.com/sdk/js?client-id=${PAYPAL_CLIENT_ID}&vault=true&intent=subscription&enable-funding=card&disable-funding=venmo,paylater`;
    script.setAttribute('data-sdk-integration-source', 'button-factory');
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load PayPal'));
    document.body.appendChild(script);
  });
  return paypalSdkPromise;
}

export default function NaviSubscribe({ mode, onAuthenticated, onClose }: NaviSubscribeProps) {
  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [payReady, setPayReady] = useState(false);
  const paypalRef = useRef<HTMLDivElement>(null);
  const renderedRef = useRef(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const cardRenderedRef = useRef(false);

  const price = mode === 'mini' ? '$10' : '$20';
  const accent = mode === 'mini' ? '#FA00FF' : '#00F7FF';
  const label = mode === 'mini' ? 'NAVI Mini' : 'NAVI Max';

  async function handleEmail() {
    if (!email.trim()) return;
    setLoading(true);
    setError('');
    const { error: err } = await sendMagicLink(email.trim());
    setLoading(false);
    if (err) { setError(err); return; }

    const sub = await getSubscriptionStatus(email.trim());
    if (sub.active && (sub.tier === mode || (mode === 'mini' && sub.tier === 'max'))) {
      const session: NaviSession = { email: email.trim(), access_token: '' };
      storeSession(session);
      onAuthenticated(session);
    } else {
      setStep('upgrade');
    }
  }

  // Render the PayPal button when we reach the upgrade step
  useEffect(() => {
    if (step !== 'upgrade') return;
    let cancelled = false;

    loadPayPalSdk()
      .then(() => {
        if (cancelled || renderedRef.current || !paypalRef.current) return;
        const paypal = (window as any).paypal;
        if (!paypal || !paypal.Buttons) return;
        renderedRef.current = true;

        paypal.Buttons({
          style: { shape: 'rect', color: 'black', layout: 'vertical', label: 'subscribe' },
          createSubscription: async () => {
            const res = await fetch(PAYPAL_FN, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'create-subscription', tier: mode, email: email.trim() }),
            });
            const data = await res.json();
            if (!res.ok || !data.subscriptionId) {
              throw new Error(data.error || 'Could not start subscription');
            }
            return data.subscriptionId;
          },
          onApprove: async (data: { subscriptionID?: string }) => {
            const subscriptionId = data.subscriptionID;
            const res = await fetch(PAYPAL_FN, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ action: 'activate', subscriptionId, email: email.trim(), tier: mode }),
            });
            const result = await res.json();
            if (res.ok && result.success) {
              const session: NaviSession = { email: email.trim(), access_token: '' };
              storeSession(session);
              setStep('success');
              setTimeout(() => onAuthenticated(session), 1400);
            } else {
              setError('Payment received — activating shortly. Please refresh in a moment.');
            }
          },
          onError: () => {
            setError('Something went wrong with PayPal. Please try again.');
          },
        }).render(paypalRef.current).then(() => {
          if (!cancelled) setPayReady(true);
        });

        // Render a separate Card funding button below the PayPal button
        const cardPaypal = (window as any).paypal;
        if (cardPaypal?.Buttons && cardRef.current && !cardRenderedRef.current) {
          const cardBtn = cardPaypal.Buttons({
            fundingSource: cardPaypal.FUNDING.CARD,
            createSubscription: async () => {
              const res = await fetch(PAYPAL_FN, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'create-subscription', tier: mode, email: email.trim() }),
              });
              const data = await res.json();
              if (!res.ok || !data.subscriptionId) {
                throw new Error(data.error || 'Could not start subscription');
              }
              return data.subscriptionId;
            },
            onApprove: async (data: { subscriptionID?: string }) => {
              const subscriptionId = data.subscriptionID;
              const res = await fetch(PAYPAL_FN, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ action: 'activate', subscriptionId, email: email.trim(), tier: mode }),
              });
              const result = await res.json();
              if (res.ok && result.success) {
                const session: NaviSession = { email: email.trim(), access_token: '' };
                storeSession(session);
                setStep('success');
                setTimeout(() => onAuthenticated(session), 1400);
              } else {
                setError('Payment received — activating shortly. Please refresh in a moment.');
              }
            },
            onError: () => {
              setError('Something went wrong. Please try again.');
            },
          });
          if (cardBtn.isEligible()) {
            cardRenderedRef.current = true;
            cardBtn.render(cardRef.current);
          }
        }
      })
      .catch(() => {
        if (!cancelled) setError('Could not load PayPal. Please try again.');
      });

    return () => { cancelled = true; };
  }, [step, mode, email, onAuthenticated]);

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
              <div style={{ color: '#888', fontSize: '15px', marginTop: '6px' }}>{price}/month</div>
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
              {loading ? 'Checking...' : 'Upgrade Now'}
            </button>
            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', color: '#555', fontSize: '14px', fontFamily: 'Fredoka, sans-serif', cursor: 'pointer', textDecoration: 'underline', padding: '4px 0', alignSelf: 'center' }}
            >
              Continue with Free NAVI
            </button>
          </>
        )}

        {step === 'upgrade' && (
          <>
            <div style={{ textAlign: 'center', fontSize: '24px', fontWeight: 700, color: accent }}>Upgrade to {label}</div>
            <div style={{ color: '#aaa', fontSize: '14px', lineHeight: 1.7, textAlign: 'center' }}>
              Verified as <span style={{ color: '#fff' }}>{email}</span>.
            </div>
            <div style={{ background: '#111', border: `1px solid ${accent}33`, borderRadius: '12px', padding: '20px', textAlign: 'center' }}>
              <div style={{ color: accent, fontWeight: 700, fontSize: '22px' }}>
                {price}<span style={{ fontSize: '13px', color: '#888', fontWeight: 400 }}>/month</span>
              </div>
            </div>

            {!payReady && !error && (
              <div style={{ color: '#666', fontSize: '13px', textAlign: 'center' }}>Loading secure checkout…</div>
            )}
            {error && <div style={{ color: '#ff4444', fontSize: '13px', textAlign: 'center' }}>{error}</div>}
            <div ref={paypalRef} style={{ minHeight: '48px' }} />
            <div ref={cardRef} style={{ minHeight: '0px' }} />

            <button
              onClick={onClose}
              style={{ background: 'none', border: 'none', color: '#555', fontSize: '14px', fontFamily: 'Fredoka, sans-serif', cursor: 'pointer', textDecoration: 'underline', padding: '4px 0', alignSelf: 'center' }}
            >
              Continue with Free NAVI
            </button>
          </>
        )}

        {step === 'success' && (
          <div style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', gap: '14px', padding: '20px 0' }}>
            <div style={{ fontSize: '40px' }}>✓</div>
            <div style={{ fontSize: '24px', fontWeight: 700, color: accent }}>Welcome to {label}</div>
            <div style={{ color: '#aaa', fontSize: '14px', lineHeight: 1.6 }}>
              Your subscription is active! Check your inbox for a verification email from NAVI — click the link to unlock Mini/Max in this session.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
