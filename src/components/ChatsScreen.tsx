import type { FC } from 'react';

interface Props {
  onClose: () => void;
}

const ChatsScreen: FC<Props> = ({ onClose }) => (
  <div style={{
    position: 'fixed',
    inset: 0,
    background: '#000',
    zIndex: 999,
    display: 'flex',
    flexDirection: 'column',
    fontFamily: 'Fredoka, sans-serif',
  }}>

    {/* Back button */}
    <div style={{ padding: '1.25rem 1.25rem 0', maxWidth: '480px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
      <button onClick={onClose} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
        <div style={{ width: '42px', height: '42px', background: '#00F7FF', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
            <path d="M17 7H1M7 1L1 7l6 6" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </button>
    </div>

    {/* Placeholder content */}
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      alignItems: 'center',
      maxWidth: '480px',
      margin: '0 auto',
      width: '100%',
      padding: '0 2.5rem',
      boxSizing: 'border-box',
      gap: '1.2rem',
      textAlign: 'center',
    }}>
      {/* Chat bubble icon */}
      <svg width="52" height="48" viewBox="0 0 52 48" fill="none">
        <rect x="1" y="1" width="50" height="38" rx="10" stroke="#333" strokeWidth="2"/>
        <path d="M10 46l6-7h10" stroke="#333" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        <line x1="13" y1="14" x2="39" y2="14" stroke="#333" strokeWidth="2" strokeLinecap="round"/>
        <line x1="13" y1="22" x2="33" y2="22" stroke="#333" strokeWidth="2" strokeLinecap="round"/>
      </svg>

      <div style={{ color: '#fff', fontSize: '1.6rem', fontWeight: 700 }}>Your Chats</div>
      <div style={{ color: '#444', fontSize: '1rem', lineHeight: 1.6 }}>
        Sign in with your email to access your past conversations with NAVI.
      </div>

      <button style={{
        marginTop: '0.5rem',
        background: '#00F7FF',
        color: '#000',
        border: 'none',
        borderRadius: '2rem',
        padding: '0.75rem 2.2rem',
        fontSize: '1.05rem',
        fontWeight: 700,
        fontFamily: 'Fredoka, sans-serif',
        cursor: 'pointer',
      }}>
        Sign In
      </button>
    </div>
  </div>
);

export default ChatsScreen;