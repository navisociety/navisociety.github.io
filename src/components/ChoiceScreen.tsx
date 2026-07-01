import { FC, useState, useEffect, useCallback } from 'react';

interface ChoiceScreenProps {
  onClose: () => void;
  session: { email: string } | null;
}

interface ChoiceItem {
  id: string;
  user_email: string;
  question: string;
  pros: string;
  cons: string;
  verdict: string;
  answer: string;
  created_at: string;
}

const CHOICE_API = 'https://irssegzkvxyewuxgqpwi.supabase.co/functions/v1/navi-choice';

const CYAN = '#00F7FF';
const MAG = '#FA00FF';
const LIME = '#CCFF00';
const RED = '#FA0000';
const INK = '#1A1A2E';
const GREY = '#8892A6';

async function callApi(url: string, body: Record<string, unknown>) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? `Error ${res.status}`);
  return data;
}

function verdictColor(v: string): string {
  if (v === 'Go for it') return LIME;
  if (v === 'Lean toward yes') return CYAN;
  if (v === 'Lean toward no') return MAG;
  if (v.startsWith("Don't")) return RED;
  return GREY;
}

const BackBtn: FC<{ onClick: () => void }> = ({ onClick }) => (
  <button onClick={onClick} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', flexShrink: 0 }}>
    <div style={{ width: 42, height: 42, background: CYAN, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <svg width="18" height="14" viewBox="0 0 18 14" fill="none">
        <path d="M17 7H1M7 1L1 7l6 6" stroke="#000" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  </button>
);

const NaviAvatar: FC = () => (
  <div style={{ width: 28, height: 28, borderRadius: 8, background: MAG, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontWeight: 700, color: '#000', fontSize: '0.85rem' }}>
    N
  </div>
);

const btnCyan: React.CSSProperties = {
  background: CYAN, color: '#000', border: 'none', borderRadius: 10,
  fontFamily: 'Fredoka, sans-serif', fontWeight: 700, fontSize: '1rem',
  padding: '0.85rem 1.2rem', cursor: 'pointer',
};

const inputStyle: React.CSSProperties = {
  background: '#F5F8FF', border: '1px solid #DCE6F5', color: INK,
  borderRadius: 10, padding: '0.85rem', fontFamily: 'Fredoka, sans-serif',
  fontSize: '1rem', width: '100%', boxSizing: 'border-box', resize: 'vertical',
};

const fieldLabel: React.CSSProperties = {
  color: GREY, fontSize: '0.8rem', fontWeight: 700,
  marginBottom: '0.5rem', fontFamily: 'Fredoka, sans-serif',
};

const container: React.CSSProperties = {
  position: 'fixed', inset: 0, background: '#FFFFFF', zIndex: 1000,
  display: 'flex', flexDirection: 'column', fontFamily: 'Fredoka, sans-serif',
};
const topBar: React.CSSProperties = {
  padding: '1.25rem 1.25rem 0', maxWidth: 480, margin: '0 auto',
  width: '100%', boxSizing: 'border-box',
};
const scrollArea: React.CSSProperties = {
  flex: 1, overflowY: 'auto', maxWidth: 480, margin: '0 auto',
  width: '100%', padding: '1rem 1.25rem', boxSizing: 'border-box',
};

const ChoiceScreen: FC<ChoiceScreenProps> = ({ onClose, session }) => {
  const email = session?.email ?? null;
  const [view, setView] = useState<'list' | 'form' | 'result'>('list');
  const [choices, setChoices] = useState<ChoiceItem[]>([]);
  const [activeChoice, setActiveChoice] = useState<ChoiceItem | null>(null);
  const [question, setQuestion] = useState('');
  const [pros, setPros] = useState('');
  const [cons, setCons] = useState('');
  const [loading, setLoading] = useState(false);
  const [listLoading, setListLoading] = useState(false);
  const [error, setError] = useState('');

  const loadChoices = useCallback(async () => {
    if (!email) return;
    setListLoading(true); setError('');
    try {
      const d = await callApi(CHOICE_API, { action: 'list-choices', email });
      setChoices(d.choices ?? []);
    } catch (e) { setError(String(e)); } finally { setListLoading(false); }
  }, [email]);

  useEffect(() => { loadChoices(); }, [loadChoices]);

  if (!email) {
    return (
      <div style={container}>
        <div style={topBar}><BackBtn onClick={onClose} /></div>
        <div style={{ ...scrollArea, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center' }}>
          <span style={{ color: INK, fontSize: '1.2rem', fontWeight: 700 }}>Sign in to use Choice</span>
          <span style={{ color: GREY, fontSize: '0.9rem', marginTop: '0.5rem' }}>Open the menu and sign in first.</span>
        </div>
      </div>
    );
  }

  const newChoice = () => {
    setActiveChoice(null);
    setQuestion(''); setPros(''); setCons('');
    setError('');
    setView('form');
  };

  const openChoice = (ch: ChoiceItem) => {
    setActiveChoice(ch);
    setView('result');
  };

  const submitChoice = async () => {
    const cleanQ = question.trim();
    if (!cleanQ) { setError('Tell me what choice you need to make.'); return; }
    setLoading(true); setError('');
    try {
      const d = await callApi(CHOICE_API, { action: 'add-choice', email, question: cleanQ, pros, cons });
      setActiveChoice(d.choice as ChoiceItem);
      setView('result');
      loadChoices();
    } catch (e) { setError(String(e)); } finally { setLoading(false); }
  };

  const deleteChoice = async (ch: ChoiceItem, e: React.MouseEvent) => {
    e.stopPropagation();
    if (!window.confirm('Delete this choice?')) return;
    try {
      await callApi(CHOICE_API, { action: 'delete-choice', email, id: ch.id });
      if (activeChoice?.id === ch.id) { setActiveChoice(null); setView('list'); }
      loadChoices();
    } catch (err) { setError(String(err)); }
  };

  const formatDate = (d: string) => {
    try { return new Date(d).toLocaleDateString('en-ZA', { day: 'numeric', month: 'short' }); } catch { return d; }
  };

  // --- Result view ---
  if (view === 'result' && activeChoice) {
    return (
      <div style={container}>
        <div style={topBar}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <BackBtn onClick={() => { setView('list'); setActiveChoice(null); }} />
            <span style={{ color: INK, fontSize: '1.1rem', fontWeight: 700 }}>Choice</span>
          </div>
        </div>
        <div style={scrollArea}>
          <div style={{ background: '#F5F8FF', border: '1px solid #DCE6F5', borderRadius: 14, padding: '1.25rem', marginBottom: '1.25rem' }}>
            <div style={fieldLabel}>You asked</div>
            <span style={{ color: INK, fontSize: '1.05rem', fontWeight: 700, lineHeight: 1.4 }}>{activeChoice.question}</span>
          </div>

          <span style={{
            display: 'inline-block', color: '#000', background: verdictColor(activeChoice.verdict),
            fontSize: '0.8rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5,
            borderRadius: 999, padding: '4px 12px', marginBottom: '1.25rem',
          }}>
            {activeChoice.verdict}
          </span>

          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start', background: '#fff', border: `1px solid ${CYAN}`, borderRadius: 14, padding: '1.1rem', boxShadow: '0 4px 14px rgba(26,26,46,0.1)' }}>
            <NaviAvatar />
            <span style={{ color: INK, fontSize: '0.95rem', lineHeight: 1.7, whiteSpace: 'pre-line' }}>{activeChoice.answer}</span>
          </div>

          <button style={{ ...btnCyan, width: '100%', marginTop: '1.25rem' }} onClick={() => { setView('list'); setActiveChoice(null); }}>
            Back to Choices
          </button>
        </div>
      </div>
    );
  }

  // --- Form view ---
  if (view === 'form') {
    return (
      <div style={container}>
        <div style={topBar}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <BackBtn onClick={() => { setView('list'); setError(''); }} />
            <span style={{ color: INK, fontSize: '1.1rem', fontWeight: 700 }}>Make a Choice</span>
          </div>
        </div>
        <div style={scrollArea}>
          {error && <div style={{ color: RED, fontSize: '0.9rem', marginBottom: '0.75rem' }}>{error}</div>}

          <div style={fieldLabel}>What choice do you need to make?</div>
          <textarea
            value={question}
            onChange={e => setQuestion(e.target.value)}
            rows={2}
            placeholder="e.g. Should I take the new job offer?"
            style={{ ...inputStyle, marginBottom: '1.1rem' }}
          />

          <div style={fieldLabel}>Pros (one per line)</div>
          <textarea
            value={pros}
            onChange={e => setPros(e.target.value)}
            rows={4}
            placeholder={'Higher pay\nBetter growth'}
            style={{ ...inputStyle, marginBottom: '1.1rem' }}
          />

          <div style={fieldLabel}>Cons (one per line)</div>
          <textarea
            value={cons}
            onChange={e => setCons(e.target.value)}
            rows={4}
            placeholder={'Longer commute\nLess job security'}
            style={{ ...inputStyle, marginBottom: '1.25rem' }}
          />

          <button style={{ ...btnCyan, width: '100%' }} onClick={submitChoice} disabled={loading || !question.trim()}>
            {loading ? 'Thinking...' : "Get NAVI's Answer"}
          </button>
        </div>
      </div>
    );
  }

  // --- List view ---
  return (
    <div style={container}>
      <div style={topBar}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <BackBtn onClick={onClose} />
          <span style={{ color: INK, fontSize: '1.6rem', fontWeight: 700 }}>Choice</span>
        </div>
      </div>
      <div style={scrollArea}>
        <button style={{ ...btnCyan, width: '100%', marginBottom: '1.25rem' }} onClick={newChoice}>
          Make a Choice
        </button>

        {error && <div style={{ color: RED, fontSize: '0.9rem', marginBottom: '0.75rem' }}>{error}</div>}
        {listLoading && <div style={{ color: GREY, textAlign: 'center', padding: '2rem 0' }}>Loading...</div>}
        {!listLoading && choices.length === 0 && (
          <div style={{ color: GREY, textAlign: 'center', padding: '2rem 0' }}>No past choices yet</div>
        )}

        {!listLoading && choices.map(ch => (
          <button key={ch.id} onClick={() => openChoice(ch)} style={{ display: 'block', width: '100%', background: '#F5F8FF', border: '1px solid #DCE6F5', borderRadius: 10, padding: '1rem', marginBottom: '0.5rem', cursor: 'pointer', textAlign: 'left' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ color: INK, fontWeight: 700, fontSize: '0.95rem', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', marginRight: '0.5rem' }}>{ch.question}</span>
              <span style={{ color: GREY, fontSize: '0.8rem', flexShrink: 0 }}>{formatDate(ch.created_at)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: '#000', background: verdictColor(ch.verdict), fontSize: '0.72rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, borderRadius: 999, padding: '2px 10px' }}>{ch.verdict}</span>
              <span onClick={(e) => deleteChoice(ch, e)} style={{ color: GREY, fontSize: '0.8rem', cursor: 'pointer', padding: '4px 8px' }} title="Delete">Delete</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default ChoiceScreen;
