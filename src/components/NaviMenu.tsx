import type { FC } from 'react';

const ITEMS = [
  { num: '01', label: 'Upgrade',    color: '#00F7FF' },
  { num: '02', label: 'Usage',      color: '#CCFF00' },
  { num: '03', label: 'My Profile', color: '#FA00FF' },
];

interface Props {
  onClose: () => void;
}

const NaviMenu: FC<Props> = ({ onClose }) => (
  <div style={{
    position: 'fixed',
    inset: 0,
    background: '#000',
    zIndex: 999,
    display: 'flex',
    flexDirection: 'column',
    fontFamily: 'Fredoka, sans-serif',
  }}>

    {/* Back button — same cyan rounded-square style as eye icon */}
    <div style={{ padding: '1.25rem 1.25rem 0', maxWidth: '480px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
      <button onClick={onClose} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
        <div style={{ width: '42px', height: '42px', background: '#00F7FF', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
            <path d="M17 7H1M7 1L1 7l6 6" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
      </button>
    </div>

    {/* Menu items — vertically centred */}
    <div style={{
      flex: 1,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      maxWidth: '480px',
      margin: '0 auto',
      width: '100%',
      padding: '0 2rem',
      boxSizing: 'border-box',
    }}>
      {ITEMS.map(({ num, label, color }) => (
        <button
          key={num}
          style={{
            background: 'none',
            border: 'none',
            padding: '1.5rem 0',
            cursor: 'pointer',
            textAlign: 'left',
            borderBottom: '1px solid #111',
            display: 'flex',
            alignItems: 'baseline',
            gap: '1rem',
          }}
        >
          <span style={{ color: '#333', fontSize: '0.9rem', fontWeight: 500, minWidth: '24px' }}>{num}</span>
          <span style={{ color, fontSize: '2.4rem', fontWeight: 700 }}>{label}</span>
        </button>
      ))}
    </div>
  </div>
);

export default NaviMenu;