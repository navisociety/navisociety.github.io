import { FC, useState } from 'react';
import EmailScreen from './EmailScreen';
import CreateScreen from './CreateScreen';

interface Props {
  onClose: () => void;
  session: { email: string } | null;
}

const ToolsScreen: FC<Props> = ({ onClose, session }) => {
  const [sub, setSub] = useState<null | 'email' | 'create'>(null);

  if (sub === 'create') {
    return <CreateScreen onClose={() => setSub(null)} session={session} />;
  }

  if (sub === 'email') {
    if (!session?.email) {
      return (
        <div style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 999, display: 'flex', flexDirection: 'column', fontFamily: 'Fredoka, sans-serif' }}>
          <div style={{ padding: '1.25rem 1.25rem 0', maxWidth: 480, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
            <button onClick={() => setSub(null)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
              <div style={{ width: 42, height: 42, background: '#00F7FF', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <svg width="18" height="14" viewBox="0 0 18 14" fill="none"><path d="M17 7H1M7 1L1 7l6 6" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              </div>
            </button>
          </div>
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', padding: '0 2rem', textAlign: 'center' }}>
            <span style={{ color: '#fff', fontSize: '1.2rem', fontWeight: 700 }}>Sign in to use Email</span>
            <span style={{ color: '#555', fontSize: '0.9rem', marginTop: '0.5rem' }}>Open the menu and sign in first.</span>
          </div>
        </div>
      );
    }
    return <EmailScreen userEmail={session.email} onBack={() => setSub(null)} />;
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: '#000', zIndex: 999, display: 'flex', flexDirection: 'column', fontFamily: 'Fredoka, sans-serif' }}>
      <div style={{ padding: '1.25rem 1.25rem 0', maxWidth: 480, margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        <button onClick={onClose} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
          <div style={{ width: 42, height: 42, background: '#00F7FF', borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <svg width="18" height="14" viewBox="0 0 18 14" fill="none"><path d="M17 7H1M7 1L1 7l6 6" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </div>
        </button>
      </div>
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', maxWidth: 480, margin: '0 auto', width: '100%', padding: '0 2rem', boxSizing: 'border-box' }}>
        <div style={{ padding: '1.5rem 0', borderBottom: '1px solid #111' }}>
          <span style={{ color: '#fff', fontSize: '2.4rem', fontWeight: 700 }}>Tools</span>
        </div>
        <button onClick={() => setSub('email')} style={{ background: 'none', border: 'none', padding: '1.5rem 0', cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid #111', width: '100%' }}>
          <span style={{ color: '#fff', fontSize: '2.4rem', fontWeight: 700 }}>Email</span>
        </button>
        <button onClick={() => setSub('create')} style={{ background: 'none', border: 'none', padding: '1.5rem 0', cursor: 'pointer', textAlign: 'left', borderBottom: '1px solid #111', width: '100%' }}>
          <span style={{ color: '#fff', fontSize: '2.4rem', fontWeight: 700 }}>Create</span>
        </button>
      </div>
    </div>
  );
};

export default ToolsScreen;