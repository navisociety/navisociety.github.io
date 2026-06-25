import { FC, useState, useEffect } from 'react';
import { getUsageStatus } from '../lib/navi-supabase';

interface Props {
  onClose: () => void;
  onSelect: (item: string) => void;
  mode: 'free' | 'mini' | 'max';
  email: string | null;
  onProfileOpen?: () => void;
}

const NaviMenu: FC<Props> = ({ onClose, onSelect, mode, email, onProfileOpen }) => {
  const [remainPct, setRemainPct] = useState<number>(1);

  useEffect(() => {
    if ((mode === 'mini' || mode === 'max') && email) {
      getUsageStatus(email, mode).then(u => {
        setRemainPct(Math.max(0, Math.min(1, 1 - u.spent_usd / u.limit_usd)));
      });
    } else {
      setRemainPct(1);
    }
  }, [mode, email]);

  const barColor = mode === 'mini' ? '#FA00FF' : '#00F7FF';
  const NAV_ITEMS = ['Upgrade', 'My Profile', 'Chats'];

  const handleItem = (label: string) => {
    if (label === 'My Profile' && onProfileOpen) {
      onProfileOpen();
      return;
    }
    onSelect(label);
  };

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

      {/* Menu items */}
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

        {/* Usage — display row, not a nav button */}
        <div style={{ padding: '1.5rem 0', borderBottom: '1px solid #111' }}>
          <span style={{ color: '#FFFFFF', fontSize: '2.4rem', fontWeight: 700 }}>Usage</span>
          <div style={{ marginTop: '14px' }}>
            <div style={{ background: '#1a1a1a', borderRadius: '100px', height: '10px', overflow: 'hidden' }}>
              <div style={{
                width: `${mode === 'free' ? 100 : remainPct * 100}%`,
                height: '100%',
                background: barColor,
                borderRadius: '100px',
                transition: 'width 0.6s ease',
              }} />
            </div>
            {mode === 'free' && (
              <div style={{ color: '#333', fontSize: '11px', marginTop: '6px' }}>Free</div>
            )}
          </div>
        </div>

        {/* Nav items */}
        {NAV_ITEMS.map(label => (
          <button
            key={label}
            onClick={() => handleItem(label)}
            style={{
              background: 'none',
              border: 'none',
              padding: '1.5rem 0',
              cursor: 'pointer',
              textAlign: 'left',
              borderBottom: '1px solid #111',
            }}
          >
            <span style={{ color: '#FFFFFF', fontSize: '2.4rem', fontWeight: 700 }}>{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default NaviMenu;
