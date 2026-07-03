// supabase/functions/navi-chat/skills.ts
//
// NAVI deterministic skills (v13): arithmetic, unit conversion, date/time.
// These answer exactly-known questions before knowledge retrieval, so NAVI
// never guesses at math or the calendar. Mirrored inline in
// src/lib/navi-model.ts (client copy uses the device's local time zone;
// this server copy answers in South Africa time).

const NAVI_TZ = 'Africa/Johannesburg';

function fmtNum(n: number): string {
  if (Number.isInteger(n) && Math.abs(n) < 1e15) return n.toLocaleString('en-US');
  return String(Number(n.toFixed(6)));
}

// Recursive-descent evaluator over + - * / % ^ ( ) sqrt and decimal numbers.
// Returns null on any malformed input instead of throwing.
function evalArithmetic(src: string): number | null {
  let i = 0;
  const skip = () => { while (src[i] === ' ') i++; };
  function parseExpr(): number {
    let v = parseTerm();
    for (;;) {
      skip();
      if (src[i] === '+') { i++; v += parseTerm(); }
      else if (src[i] === '-') { i++; v -= parseTerm(); }
      else break;
    }
    return v;
  }
  function parseTerm(): number {
    let v = parseFactor();
    for (;;) {
      skip();
      if (src[i] === '*') { i++; v *= parseFactor(); }
      else if (src[i] === '/') { i++; v /= parseFactor(); }
      else if (src[i] === '%') { i++; v %= parseFactor(); }
      else break;
    }
    return v;
  }
  function parseFactor(): number {
    const base = parseUnary();
    skip();
    if (src[i] === '^') { i++; return Math.pow(base, parseFactor()); }
    return base;
  }
  function parseUnary(): number {
    skip();
    if (src[i] === '-') { i++; return -parseUnary(); }
    if (src[i] === '+') { i++; return parseUnary(); }
    if (src.startsWith('sqrt', i)) { i += 4; return Math.sqrt(parseUnary()); }
    if (src[i] === '(') {
      i++;
      const v = parseExpr();
      skip();
      if (src[i] !== ')') throw new Error('unbalanced');
      i++;
      return v;
    }
    const m = /^\d+(?:\.\d+)?/.exec(src.slice(i));
    if (!m) throw new Error('expected number');
    i += m[0].length;
    return parseFloat(m[0]);
  }
  try {
    const v = parseExpr();
    skip();
    return i === src.length ? v : null;
  } catch {
    return null;
  }
}

export function tryMath(message: string): string | null {
  let s = message.toLowerCase().trim().replace(/[?!.=\s]+$/g, '');
  s = s.replace(
    /^(?:hey\s+navi[,:\s]+|navi[,:\s]+)?(?:please\s+)?(?:can\s+you\s+)?(?:what\s+is|what's|whats|calculate|compute|solve|evaluate|work\s+out|how\s+much\s+is)\s+/,
    ''
  ).trim();

  // "15% of 200" style asks.
  const pct = s.match(/^(-?\d+(?:\.\d+)?)\s*(?:%|percent)\s+of\s+(-?\d+(?:\.\d+)?)$/);
  if (pct) {
    const p = parseFloat(pct[1]), n = parseFloat(pct[2]);
    return `${fmtNum(p)}% of ${fmtNum(n)} is ${fmtNum((p / 100) * n)}.`;
  }

  s = s
    .replace(/\bsquare\s+root\s+of\b/g, 'sqrt')
    .replace(/\bto\s+the\s+power\s+of\b/g, '^')
    .replace(/\bsquared\b/g, '^2')
    .replace(/\bcubed\b/g, '^3')
    .replace(/\bplus\b/g, '+')
    .replace(/\bminus\b/g, '-')
    .replace(/\b(?:times|multiplied\s+by)\b/g, '*')
    .replace(/\bdivided\s+by\b/g, '/')
    .replace(/[×✕]/g, '*')
    .replace(/÷/g, '/')
    .replace(/,/g, '')
    .trim();

  // Must now be purely arithmetic — this rejects Bible refs (colons), dates,
  // phone numbers without operators, and any sentence with leftover words.
  if (!/^[\d\s+\-*/%^().#]+$/.test(s.replace(/sqrt/g, '#'))) return null;
  if (!/\d/.test(s)) return null;
  if (!/[+*/%^]|sqrt/.test(s) && !/\d\s*-\s*\d/.test(s)) return null; // needs an actual operation

  const v = evalArithmetic(s);
  if (v === null) return null;
  if (!Number.isFinite(v)) {
    return s.includes('/')
      ? "That one breaks math — dividing by zero has no answer. Change the numbers and I'll compute it."
      : null;
  }
  const display = s.replace(/\*/g, ' × ').replace(/\//g, ' ÷ ').replace(/sqrt/g, '√').replace(/\s+/g, ' ').trim();
  return `${display} = ${fmtNum(v)}`;
}

type Unit = { rx: RegExp; kind: string; factor: number; label: string };

const UNITS: Unit[] = [
  { rx: /^(?:km|kilometers?|kilometres?)$/, kind: 'len', factor: 1000, label: 'km' },
  { rx: /^(?:m|meters?|metres?)$/, kind: 'len', factor: 1, label: 'm' },
  { rx: /^(?:cm|centimeters?|centimetres?)$/, kind: 'len', factor: 0.01, label: 'cm' },
  { rx: /^(?:mm|millimeters?|millimetres?)$/, kind: 'len', factor: 0.001, label: 'mm' },
  { rx: /^(?:mi|miles?)$/, kind: 'len', factor: 1609.344, label: 'miles' },
  { rx: /^(?:ft|foot|feet)$/, kind: 'len', factor: 0.3048, label: 'feet' },
  { rx: /^(?:inch|inches)$/, kind: 'len', factor: 0.0254, label: 'inches' },
  { rx: /^(?:kg|kilograms?|kilos?)$/, kind: 'mass', factor: 1, label: 'kg' },
  { rx: /^(?:g|grams?)$/, kind: 'mass', factor: 0.001, label: 'g' },
  { rx: /^(?:lb|lbs|pounds?)$/, kind: 'mass', factor: 0.45359237, label: 'pounds' },
  { rx: /^(?:oz|ounces?)$/, kind: 'mass', factor: 0.028349523125, label: 'ounces' },
  { rx: /^(?:tons?|tonnes?)$/, kind: 'mass', factor: 1000, label: 'tonnes' },
  { rx: /^(?:l|liters?|litres?)$/, kind: 'vol', factor: 1, label: 'litres' },
  { rx: /^(?:ml|milliliters?|millilitres?)$/, kind: 'vol', factor: 0.001, label: 'ml' },
  { rx: /^(?:gal|gallons?)$/, kind: 'vol', factor: 3.785411784, label: 'gallons (US)' },
  { rx: /^(?:°?c|celsius|centigrade)$/, kind: 'temp', factor: 1, label: '°C' },
  { rx: /^(?:°?f|fahrenheit)$/, kind: 'temp', factor: 1, label: '°F' },
];

function findUnit(word: string): Unit | undefined {
  return UNITS.find(u => u.rx.test(word));
}

export function tryUnits(message: string): string | null {
  const m = message
    .toLowerCase()
    .match(/(?:convert\s+)?(-?\d+(?:\.\d+)?)\s*(°?[a-z]+)\s+(?:to|into|in|as)\s+(°?[a-z]+)\b/);
  if (!m) return null;
  const v = parseFloat(m[1]);
  const from = findUnit(m[2]);
  const to = findUnit(m[3]);
  if (!from || !to || from.kind !== to.kind || from.label === to.label) return null;

  let out: number;
  if (from.kind === 'temp') {
    if (from.label === '°C') out = v * 9 / 5 + 32;
    else out = (v - 32) * 5 / 9;
  } else {
    out = (v * from.factor) / to.factor;
  }
  const rounded = Math.abs(out) >= 100 ? Math.round(out * 10) / 10 : Math.round(out * 10000) / 10000;
  const sign = rounded === out ? '=' : '≈';
  return `${fmtNum(v)} ${from.label} ${sign} ${fmtNum(rounded)} ${to.label}.`;
}

export function tryDateTime(message: string, tz: string | undefined = NAVI_TZ): string | null {
  const t = message.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.length > 60) return null;
  const opts = tz ? { timeZone: tz } : {};
  const label = tz ? ' (South Africa time)' : '';
  const now = new Date();

  if (/\b(what time is it|what is the time|whats the time|current time|time right now|tell me the time)\b/.test(t)) {
    const time = now.toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit', hour12: false, ...opts });
    return `It's ${time}${label}. What are we doing with the rest of the day?`;
  }
  if (/\b(what day is it|what is the date|whats the date|what date is it|todays date|what is todays date|date today|which day is it)\b/.test(t)) {
    const date = now.toLocaleDateString('en-ZA', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', ...opts });
    return `Today is ${date}. What's the plan for it?`;
  }
  if (/\b(what year is it|what is the year|whats the year|which year is it|what year are we in)\b/.test(t)) {
    const year = now.toLocaleDateString('en-ZA', { year: 'numeric', ...opts });
    return `It's ${year}. Time moves — what are you building this year?`;
  }
  if (/\b(what month is it|what is the month|whats the month|which month is it|what month are we in)\b/.test(t)) {
    const month = now.toLocaleDateString('en-ZA', { month: 'long', year: 'numeric', ...opts });
    return `We're in ${month}. How's the month treating you so far?`;
  }
  return null;
}

/** All deterministic skills in priority order. Returns null when none apply. */
export function trySkills(message: string): string | null {
  return tryMath(message) ?? tryUnits(message) ?? tryDateTime(message);
}

// A short reply like "why?" or "tell me more" inherits the previous user
// message as retrieval context instead of being matched on its own.
export function isFollowUp(message: string): boolean {
  const t = message.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.split(' ').length > 4) return false;
  return /^(why|how|how so|really|and|and then|then what|what else|else|more|tell me more|go on|keep going|explain|explain more|explain that|like what|such as|for example|meaning|what do you mean|in what way|but why|why though|elaborate|say more|continue|example|examples)$/.test(t);
}
