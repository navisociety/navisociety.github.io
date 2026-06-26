import { FC } from 'react';

interface Props {
  onClose: () => void;
}

const ToolsScreen: FC<Props> = ({ onClose }) => {
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
        justifyContent: 'center',
        alignItems: 'center',
        maxWidth: '480px',
        margin: '0 auto',
        width: '100%',
        padding: '0 2rem',
        boxSizing: 'border-box',
      }}>
        <span style={{ color: '#FFFFFF', fontSize: '2.4rem', fontWeight: 700 }}>Tools</span>
        <span style={{ color: '#333', fontSize: '1rem', marginTop: '1rem' }}>Coming soon</span>
      </div>
    </div>
  );
};

export default ToolsScreen;
