import { FC, useState } from 'react';
import EmailScreen from './EmailScreen';

interface Props {
  onClose: () => void;
  session: { email: string } | null;
}

const ToolsScreen: FC<Props> = ({ onClose, session }) => {
  const [subScreen, setSubScreen] = useState<null | 'email'>(null);

  if (subScreen === 'email') {
    if (session?.email) {
      return <EmailScreen userEmail={session.email} onBack={() => setSubScreen(null)} />;
    }
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        background: '#000',
        zIndex: 999,
        display: 'flex',
        flexDirection: 'column',
        fontFamily: 'Fredoka, sans-serif',
      }}>
        <div style={{ padding: '1.25rem 1.25rem 0', maxWidth: '480px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
          <button onClick={() => setSubScreen(null)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
            <div style={{ width: '42px', height: '42px', background: '#00F7FF', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
                <path d="M17 7H1M7 1L1 7l6 6" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
          </button>
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', maxWidth: '480px', margin: '0 auto', width: '100%', padding: '0 2rem', boxSizing: 'border-box' }}>
          <span style={{ color: '#555', fontSize: '1rem' }}>Sign in to use Email</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: '#000',
      zIndex: 999,
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'Fredoka, sans-serif',
    }}>
      <div style={{ padding: '1.25rem 1.25rem 0', maxWidth: '480px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        <button onClick={onClose} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <div style={{ width: '42px', height: '42px', background: '#00F7FF', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
              <path d="M17 7H1M7 1L1 7l6 6" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </div>
        </button>
      </div>
      <div style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        maxWidth: '480px',
        margin: '0 auto',
        width: '100%',
        padding: '0 1.25rem',
        boxSizing: 'border-box',
      }}>
        <span style={{ color: '#FFFFFF', fontSize: '2.4rem', fontWeight: 700, margin: '1.25rem 0' }}>Tools</span>
        <button
          onClick={() => setSubScreen('email')}
          style={{
            background: 'none',
            border: 'none',
            borderBottom: '1px solid #111',
            color: '#FFFFFF',
            fontSize: '2.4rem',
            fontWeight: 700,
            fontFamily: 'Fredoka, sans-serif',
            textAlign: 'left',
            width: '100%',
            padding: '0.75rem 0',
            cursor: 'pointer',
          }}
        >
          Email
        </button>
      </div>
    </div>
  );
};

export default ToolsScreen;
