import { FC, useState } from 'react';

interface CreateScreenProps {
  onClose: () => void;
  session: { email: string } | null;
}

const CYAN = '#00F7FF';
const MAG = '#FA00FF';
const GREY = '#8892A6';
const RED = '#FA0000';

type Dimensions = '1080x1920' | '1920x1080';

const HEX_RE = /^#([0-9A-Fa-f]{6})$/;

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
const scrollArea: React.CSSProperties = {
  flex: 1, overflowY: 'auto', maxWidth: 480, margin: '0 auto',
  width: '100%', padding: '1.5rem 1.25rem', boxSizing: 'border-box',
};

const fieldLabel: React.CSSProperties = {
  color: GREY, fontSize: '0.8rem', fontWeight: 700,
  marginBottom: '0.6rem', fontFamily: 'Fredoka, sans-serif',
  textTransform: 'uppercase', letterSpacing: 0.5,
};

const inputStyle: React.CSSProperties = {
  background: '#111', border: '1px solid #222', color: '#fff',
  borderRadius: 10, padding: '0.85rem', fontFamily: 'Fredoka, sans-serif',
  fontSize: '1rem', width: '100%', boxSizing: 'border-box', outline: 'none',
};

const btnCyan: React.CSSProperties = {
  background: CYAN, color: '#000', border: 'none', borderRadius: 10,
  fontFamily: 'Fredoka, sans-serif', fontWeight: 700, fontSize: '1.1rem',
  padding: '1rem 1.5rem', cursor: 'pointer',
};

const dimTile = (selected: boolean): React.CSSProperties => ({
  flex: 1, padding: '1rem 0.5rem', borderRadius: 10, cursor: 'pointer',
  textAlign: 'center', fontFamily: 'Fredoka, sans-serif', fontWeight: 700,
  background: selected ? 'rgba(0,247,255,0.12)' : '#111',
  border: `1.5px solid ${selected ? CYAN : '#222'}`,
  color: selected ? CYAN : '#fff',
});

const CreateScreen: FC<CreateScreenProps> = ({ onClose }) => {
  const [view, setView] = useState<'home' | 'new'>('home');

  const [dimensions, setDimensions] = useState<Dimensions>('1080x1920');
  const [bgColor, setBgColor] = useState('#000000');
  const [font, setFont] = useState('Fredoka');
  const [fontSize, setFontSize] = useState(48);
  const [fontColor, setFontColor] = useState('#FFFFFF');

  const bgValid = HEX_RE.test(bgColor);
  const fontColorValid = HEX_RE.test(fontColor);

  const [w, h] = dimensions.split('x').map(Number);
  const previewW = 220;
  const previewH = Math.round((previewW * h) / w);
  const previewFontSize = Math.max(6, Math.round(fontSize * (previewW / w)));

  if (view === 'home') {
    return (
      <div style={container}>
        <div style={topBar}>
          <BackBtn onClick={onClose} />
        </div>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', maxWidth: 480, margin: '0 auto', width: '100%', padding: '0 1.25rem', boxSizing: 'border-box' }}>
          <button style={btnCyan} onClick={() => setView('new')}>New Creation</button>
        </div>
      </div>
    );
  }

  return (
    <div style={container}>
      <div style={topBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <BackBtn onClick={() => setView('home')} />
          <span style={{ color: '#fff', fontSize: '1.1rem', fontWeight: 700 }}>New Creation</span>
        </div>
      </div>
      <div style={scrollArea}>

        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1.5rem' }}>
          <div style={{
            width: previewW, height: previewH, borderRadius: 10,
            background: bgValid ? bgColor : '#111',
            border: `1px solid ${MAG}`, display: 'flex',
            alignItems: 'center', justifyContent: 'center', overflow: 'hidden',
          }}>
            <span style={{
              fontFamily: `${font}, sans-serif`, fontSize: previewFontSize,
              color: fontColorValid ? fontColor : GREY, fontWeight: 700, padding: '0 8px', textAlign: 'center',
            }}>
              Aa
            </span>
          </div>
        </div>

        <div style={fieldLabel}>1. Dimensions</div>
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem' }}>
          <div style={dimTile(dimensions === '1080x1920')} onClick={() => setDimensions('1080x1920')}>
            1080 × 1920
          </div>
          <div style={dimTile(dimensions === '1920x1080')} onClick={() => setDimensions('1920x1080')}>
            1920 × 1080
          </div>
        </div>

        <div style={fieldLabel}>2. Background Colour</div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: bgValid ? '1.25rem' : '0.4rem' }}>
          <div style={{ width: 42, height: 42, borderRadius: 8, flexShrink: 0, background: bgValid ? bgColor : '#111', border: '1px solid #222' }} />
          <input
            style={inputStyle}
            value={bgColor}
            onChange={e => setBgColor(e.target.value)}
            placeholder="#000000"
            maxLength={7}
          />
        </div>
        {!bgValid && <div style={{ color: RED, fontSize: '0.8rem', marginBottom: '1.25rem' }}>Enter a valid hex colour, e.g. #000000</div>}

        <div style={fieldLabel}>3. Font</div>
        <input
          style={{ ...inputStyle, marginBottom: '1.25rem' }}
          value={font}
          onChange={e => setFont(e.target.value)}
          placeholder="Fredoka"
        />

        <div style={fieldLabel}>4. Font Size</div>
        <input
          type="number"
          style={{ ...inputStyle, marginBottom: '1.25rem' }}
          value={fontSize}
          min={8}
          max={300}
          onChange={e => setFontSize(Number(e.target.value) || 0)}
        />

        <div style={fieldLabel}>5. Font Colour</div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: fontColorValid ? '0.5rem' : '0.4rem' }}>
          <div style={{ width: 42, height: 42, borderRadius: 8, flexShrink: 0, background: fontColorValid ? fontColor : '#111', border: '1px solid #222' }} />
          <input
            style={inputStyle}
            value={fontColor}
            onChange={e => setFontColor(e.target.value)}
            placeholder="#FFFFFF"
            maxLength={7}
          />
        </div>
        {!fontColorValid && <div style={{ color: RED, fontSize: '0.8rem' }}>Enter a valid hex colour, e.g. #FFFFFF</div>}

      </div>
    </div>
  );
};

export default CreateScreen;
