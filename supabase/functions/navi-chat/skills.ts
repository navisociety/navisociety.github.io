// supabase/functions/navi-chat/skills.ts
//
// NAVI deterministic skills (v13, extended in v15 + v16): arithmetic,
// percentages (discounts/tips), list stats, date countdowns, unit conversion,
// date/time, world time, day-of-week for any date, birth-year age, word tools
// (spell/letters/reverse), coin/dice/random numbers.
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

// ── v15 skills: percentages, list stats, date countdowns, randomness ─────────

/** Discounts, increases, and tips: "20% off 500", "add 15% to 200", "10% tip on 340". */
export function tryPercentOps(message: string): string | null {
  const t = message.toLowerCase().replace(/,/g, '');

  const off = t.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)\s+(?:off|discount(?:\s+on)?)\s+(?:of\s+)?(?:r|\$|€|£)?\s*(\d+(?:\.\d+)?)/);
  if (off) {
    const p = parseFloat(off[1]), n = parseFloat(off[2]);
    const save = (p / 100) * n;
    return `${fmtNum(p)}% off ${fmtNum(n)} leaves ${fmtNum(n - save)} — you save ${fmtNum(save)}.`;
  }

  const add = t.match(/add\s+(\d+(?:\.\d+)?)\s*(?:%|percent)\s+to\s+(?:r|\$|€|£)?\s*(\d+(?:\.\d+)?)/);
  if (add) {
    const p = parseFloat(add[1]), n = parseFloat(add[2]);
    return `${fmtNum(n)} plus ${fmtNum(p)}% is ${fmtNum(n + (p / 100) * n)}.`;
  }

  const tip = t.match(/(\d+(?:\.\d+)?)\s*(?:%|percent)\s+tip\s+on\s+(?:r|\$|€|£)?\s*(\d+(?:\.\d+)?)/);
  if (tip) {
    const p = parseFloat(tip[1]), n = parseFloat(tip[2]);
    const amt = (p / 100) * n;
    return `A ${fmtNum(p)}% tip on ${fmtNum(n)} is ${fmtNum(amt)}, so ${fmtNum(n + amt)} total.`;
  }

  return null;
}

/** Average / sum / max / min over a spoken list: "average of 4, 8 and 15". */
export function tryListStats(message: string): string | null {
  const m = message.toLowerCase().match(/\b(average|mean|sum|total|max(?:imum)?|min(?:imum)?)\s+of\s+([\d\s.,]+(?:and\s+[\d.]+)?)/);
  if (!m) return null;
  const nums = (m[2].match(/\d+(?:\.\d+)?/g) ?? []).map(Number);
  if (nums.length < 2) return null;
  const parts = nums.map(fmtNum);
  const list = `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  const op = m[1];
  if (op === 'average' || op === 'mean') {
    const avg = nums.reduce((a, b) => a + b, 0) / nums.length;
    return `The average of ${list} is ${fmtNum(Number(avg.toFixed(6)))}.`;
  }
  if (op === 'sum' || op === 'total') {
    return `The sum of ${list} is ${fmtNum(nums.reduce((a, b) => a + b, 0))}.`;
  }
  if (op.startsWith('max')) return `The biggest of ${list} is ${fmtNum(Math.max(...nums))}.`;
  return `The smallest of ${list} is ${fmtNum(Math.min(...nums))}.`;
}

const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];

const NAMED_DAYS: Array<{ rx: RegExp; month: number; day: number; label: string }> = [
  { rx: /\bchristmas\b/, month: 12, day: 25, label: 'Christmas' },
  { rx: /\bnew year'?s? eve\b/, month: 12, day: 31, label: "New Year's Eve" },
  { rx: /\bnew year\b/, month: 1, day: 1, label: "New Year's Day" },
  { rx: /\bvalentine'?s?(?:\s+day)?\b/, month: 2, day: 14, label: "Valentine's Day" },
  { rx: /\bhalloween\b/, month: 10, day: 31, label: 'Halloween' },
];

export function todayInTZ(tz: string): { y: number; m: number; d: number } {
  const [y, m, d] = new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date()).split('-').map(Number);
  return { y, m, d };
}

/** "How many days until Christmas / 25 December / March 3" — counted in SA time. */
export function tryDaysUntil(message: string, tz: string = NAVI_TZ): string | null {
  const t = message.toLowerCase();
  if (!/\b(days?\s+(?:until|till|to|left\s+(?:until|till|before))|how\s+long\s+(?:until|till)|countdown\s+to)\b/.test(t)) return null;

  let month = 0, day = 0, label = '';
  for (const nd of NAMED_DAYS) {
    if (nd.rx.test(t)) { month = nd.month; day = nd.day; label = nd.label; break; }
  }
  if (!month) {
    const dm = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)\b/) ??
               t.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2})(?:st|nd|rd|th)?\b/);
    if (!dm) return null;
    const [a, b] = [dm[1], dm[2]];
    if (/^\d/.test(a)) { day = parseInt(a, 10); month = MONTHS.indexOf(b) + 1; }
    else { month = MONTHS.indexOf(a) + 1; day = parseInt(b, 10); }
    if (day < 1 || day > 31) return null;
    label = `${day} ${MONTHS[month - 1].charAt(0).toUpperCase()}${MONTHS[month - 1].slice(1)}`;
  }

  const now = todayInTZ(tz);
  let target = Date.UTC(now.y, month - 1, day);
  const today = Date.UTC(now.y, now.m - 1, now.d);
  if (target < today) target = Date.UTC(now.y + 1, month - 1, day);
  const days = Math.round((target - today) / 86400000);
  if (days === 0) return `${label} is today. Enjoy it.`;
  if (days === 1) return `${label} is tomorrow — one day away.`;
  return `${label} is ${days.toLocaleString('en-US')} days away.`;
}

/** Coin flips, dice rolls, and random numbers. */
export function tryRandom(message: string): string | null {
  const t = message.toLowerCase();

  if (/\b(flip|toss)\s+a\s+coin\b|\bcoin\s+(flip|toss)\b|\bheads\s+or\s+tails\b/.test(t)) {
    return Math.random() < 0.5 ? 'Heads.' : 'Tails.';
  }

  const dice = t.match(/\broll\s+(?:a|the|one)?\s*(?:d(\d{1,3})|die|dice)\b/);
  if (dice) {
    const sides = dice[1] ? Math.max(2, Math.min(1000, parseInt(dice[1], 10))) : 6;
    const roll = 1 + Math.floor(Math.random() * sides);
    return `You rolled a ${roll}${dice[1] ? ` (d${sides})` : ''}.`;
  }

  const range = t.match(/\b(?:pick|choose|give\s+me|random)\s+(?:a\s+)?(?:random\s+)?number\s+(?:between|from)\s+(-?\d+)\s+(?:and|to)\s+(-?\d+)\b/);
  if (range) {
    const a = parseInt(range[1], 10), b = parseInt(range[2], 10);
    const lo = Math.min(a, b), hi = Math.max(a, b);
    const n = lo + Math.floor(Math.random() * (hi - lo + 1));
    return `${n.toLocaleString('en-US')}. That's my pick between ${fmtNum(lo)} and ${fmtNum(hi)}.`;
  }

  return null;
}

// ── v16 skills: world time, day-of-week, birth-year age, word tools ─────────

const CITY_TZ: Array<{ rx: RegExp; tz: string; label: string }> = [
  { rx: /\b(johannesburg|joburg|jozi|pretoria|cape town|durban|south africa|sa)\b/, tz: 'Africa/Johannesburg', label: 'South Africa' },
  { rx: /\b(london|uk|england|britain)\b/, tz: 'Europe/London', label: 'London' },
  { rx: /\b(paris|france)\b/, tz: 'Europe/Paris', label: 'Paris' },
  { rx: /\b(berlin|germany)\b/, tz: 'Europe/Berlin', label: 'Berlin' },
  { rx: /\b(amsterdam|netherlands|holland)\b/, tz: 'Europe/Amsterdam', label: 'Amsterdam' },
  { rx: /\b(madrid|spain)\b/, tz: 'Europe/Madrid', label: 'Madrid' },
  { rx: /\b(rome|italy)\b/, tz: 'Europe/Rome', label: 'Rome' },
  { rx: /\b(lisbon|portugal)\b/, tz: 'Europe/Lisbon', label: 'Lisbon' },
  { rx: /\b(athens|greece)\b/, tz: 'Europe/Athens', label: 'Athens' },
  { rx: /\b(istanbul|turkey)\b/, tz: 'Europe/Istanbul', label: 'Istanbul' },
  { rx: /\b(moscow|russia)\b/, tz: 'Europe/Moscow', label: 'Moscow' },
  { rx: /\b(new york|nyc|manhattan)\b/, tz: 'America/New_York', label: 'New York' },
  { rx: /\b(los angeles|la|california|san francisco|seattle)\b/, tz: 'America/Los_Angeles', label: 'the US West Coast' },
  { rx: /\b(chicago|texas|houston|dallas)\b/, tz: 'America/Chicago', label: 'the US Central zone' },
  { rx: /\b(toronto|canada)\b/, tz: 'America/Toronto', label: 'Toronto' },
  { rx: /\b(mexico city|mexico)\b/, tz: 'America/Mexico_City', label: 'Mexico City' },
  { rx: /\b(sao paulo|brazil|rio)\b/, tz: 'America/Sao_Paulo', label: 'Brazil' },
  { rx: /\b(buenos aires|argentina)\b/, tz: 'America/Argentina/Buenos_Aires', label: 'Buenos Aires' },
  { rx: /\b(cairo|egypt)\b/, tz: 'Africa/Cairo', label: 'Cairo' },
  { rx: /\b(lagos|nigeria)\b/, tz: 'Africa/Lagos', label: 'Lagos' },
  { rx: /\b(nairobi|kenya)\b/, tz: 'Africa/Nairobi', label: 'Nairobi' },
  { rx: /\b(dubai|uae|abu dhabi)\b/, tz: 'Asia/Dubai', label: 'Dubai' },
  { rx: /\b(mumbai|delhi|india|bangalore)\b/, tz: 'Asia/Kolkata', label: 'India' },
  { rx: /\b(bangkok|thailand)\b/, tz: 'Asia/Bangkok', label: 'Bangkok' },
  { rx: /\b(jakarta|indonesia)\b/, tz: 'Asia/Jakarta', label: 'Jakarta' },
  { rx: /\b(singapore)\b/, tz: 'Asia/Singapore', label: 'Singapore' },
  { rx: /\b(hong kong)\b/, tz: 'Asia/Hong_Kong', label: 'Hong Kong' },
  { rx: /\b(beijing|shanghai|china)\b/, tz: 'Asia/Shanghai', label: 'China' },
  { rx: /\b(tokyo|japan)\b/, tz: 'Asia/Tokyo', label: 'Tokyo' },
  { rx: /\b(seoul|korea)\b/, tz: 'Asia/Seoul', label: 'Seoul' },
  { rx: /\b(manila|philippines)\b/, tz: 'Asia/Manila', label: 'Manila' },
  { rx: /\b(sydney|melbourne|australia)\b/, tz: 'Australia/Sydney', label: 'Sydney' },
  { rx: /\b(perth)\b/, tz: 'Australia/Perth', label: 'Perth' },
  { rx: /\b(auckland|new zealand)\b/, tz: 'Pacific/Auckland', label: 'New Zealand' },
];

/** "What time is it in Tokyo / London / New York" — any mapped city or country. */
export function tryWorldTime(message: string): string | null {
  const t = message.toLowerCase();
  const m = t.match(/\b(?:time\s+(?:is\s+it\s+)?(?:right\s+now\s+)?in|current\s+time\s+in)\s+([a-z .'-]{2,30}?)\s*[?.!]*$/);
  if (!m) return null;
  const city = CITY_TZ.find(c => c.rx.test(m[1].trim()));
  if (!city) return null;
  const now = new Date();
  const time = now.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: city.tz });
  const day = now.toLocaleDateString('en-GB', { weekday: 'long', timeZone: city.tz });
  return `It's ${time} in ${city.label} right now — ${day} there.`;
}

/** "What day of the week is 25 December 2026" / "what day was 1 january 2000". */
export function tryDayOfWeek(message: string, tz: string = NAVI_TZ): string | null {
  const t = message.toLowerCase();
  if (!/\bwhat day (?:of the week )?(?:is|was|will|does|did)\b|\bfalls? on\b|\bday of the week\b/.test(t)) return null;

  const dm = t.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+(\d{4}))?\b/) ??
             t.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?\b/);
  if (!dm) return null;
  let day: number, month: number;
  if (/^\d/.test(dm[1])) { day = parseInt(dm[1], 10); month = MONTHS.indexOf(dm[2]) + 1; }
  else { month = MONTHS.indexOf(dm[1]) + 1; day = parseInt(dm[2], 10); }
  if (day < 1 || day > 31 || month < 1) return null;

  const now = todayInTZ(tz);
  let year = dm[3] ? parseInt(dm[3], 10) : now.y;
  const today = Date.UTC(now.y, now.m - 1, now.d);
  // No year given and the date already passed → the upcoming occurrence.
  if (!dm[3] && Date.UTC(year, month - 1, day) < today) year++;

  const target = Date.UTC(year, month - 1, day);
  const weekday = new Date(target).toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' });
  const label = `${day} ${MONTHS[month - 1].charAt(0).toUpperCase()}${MONTHS[month - 1].slice(1)} ${year}`;
  return target < today ? `${label} was a ${weekday}.` : `${label} falls on a ${weekday}.`;
}

/** "I was born in 1998 — how old am I?" answered without guessing. */
export function tryBornYear(message: string, tz: string = NAVI_TZ): string | null {
  const t = message.toLowerCase();
  if (!/\b(how old|what age|age)\b/.test(t)) return null;
  const m = t.match(/\bborn in (19\d{2}|20\d{2})\b/);
  if (!m) return null;
  const year = parseInt(m[1], 10);
  const cur = todayInTZ(tz).y;
  if (year > cur) return null;
  const n = cur - year;
  if (n === 0) return `Born in ${year} means turning 1 next year — a brand new human.`;
  return `Born in ${year} means turning ${n} in ${cur} — so ${n - 1} before the birthday this year, ${n} after it.`;
}

/** Word tools: spell it, count its letters, reverse it. */
export function tryWordTools(message: string): string | null {
  const t = message.toLowerCase().trim().replace(/[?.!]+$/, '');

  const sp = t.match(/(?:how (?:do|would) (?:you|i) spell|can you spell|spell(?: the word)?)\s+"?([a-z'-]{2,30})"?$/);
  if (sp) {
    const w = sp[1];
    return `"${w}" is spelled ${w.toUpperCase().split('').join('-')}.`;
  }

  const ct = t.match(/how many letters (?:are )?(?:in|does)\s+(?:the word )?"?([a-z'-]{2,30})"?(?:\s+have)?$/);
  if (ct) {
    const w = ct[1];
    const n = (w.match(/[a-z]/g) ?? []).length;
    return `"${w}" has ${n} letters.`;
  }

  const rv = t.match(/reverse (?:the word )?"?([a-z'-]{2,30})"?$/);
  if (rv) {
    const w = rv[1];
    return `"${w}" reversed is "${w.split('').reverse().join('')}".`;
  }

  return null;
}

/** All deterministic skills in priority order. Returns null when none apply. */
export function trySkills(message: string): string | null {
  return tryMath(message) ?? tryPercentOps(message) ?? tryListStats(message) ??
    tryDaysUntil(message) ?? tryUnits(message) ?? tryDayOfWeek(message) ??
    tryWorldTime(message) ?? tryDateTime(message) ?? tryBornYear(message) ??
    tryWordTools(message) ?? tryRandom(message);
}

// A short reply like "why?" or "tell me more" inherits the previous user
// message as retrieval context instead of being matched on its own.
export function isFollowUp(message: string): boolean {
  const t = message.toLowerCase().replace(/[^a-z\s]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t || t.split(' ').length > 4) return false;
  return /^(why|how|how so|really|and|and then|then what|what else|else|more|tell me more|go on|keep going|explain|explain more|explain that|like what|such as|for example|meaning|what do you mean|in what way|but why|why though|elaborate|say more|continue|example|examples)$/.test(t);
}
