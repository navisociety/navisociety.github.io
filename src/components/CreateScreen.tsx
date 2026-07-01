import { FC } from 'react';

interface CreateScreenProps {
  onClose: () => void;
  session: { email: string } | null;
}

const CYAN = '#00F7FF';

const BackBtn: FC<{ onClick: () => void }> = ({ onClick }) => (
  <button onClick={onClick} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0 }}>
    <div style={{ width: 42, height: 42, background: CYAN, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
        <path d="M17 7H1M7 1L1 7l6 6" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  </button>
);

const container: React.CSSProperties = {
  position: 'fixed', inset: 0, background: '#000000', zIndex: 1000,
  display: 'flex', flexDirection: 'column', fontFamily: 'Fredoka, sans-serif',
};
const topBar: React.CSSProperties = {
  padding: '1.25rem 1.25rem 0', maxWidth: 480, margin: '0 auto',
  width: '100%', boxSizing: 'border-box',
};

const CreateScreen: FC<CreateScreenProps> = ({ onClose }) => {
  return (
    <div style={container}>
      <div style={topBar}>
        <BackBtn onClick={onClose} />
      </div>
    </div>
  );
};

export default CreateScreen;
