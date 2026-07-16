// supabase/functions/navi-chat/dates.ts
//
// NAVI v45 — The special-dates book (the almanac round).
//
// "My mom's birthday is on 3 august" / "our wedding anniversary is 20 june"
// is held YEARLY on the user's permanent memory row (Profile.dates) — these
// dates never expire, so unlike life.ts events they are never released and
// NAVI never asks "how did it go?". The user's OWN birthday stays where v16
// put it (Profile.birthday, memory.ts) — this book is for everyone else's.
//
// "When is my mom's birthday?" answers with a live countdown, "what special
// dates do i have" lists the book soonest-first, "forget my mom's birthday"
// drops one, and the first session of the day-of (or day-before) opens with
// a heads-up — one note per day per date (the `noted` stamp), never a nag.
//
// Signed-in only, exactly like reminders: there is nowhere to keep a date
// for an anonymous visitor. Impossible dates (29 february, 31 april) are
// refused honestly — a yearly date must exist in EVERY year, the same law
// that keeps monthly reminders at 1-28 (remind.ts v44/v45).

import { isCrisisReply, type Profile, type SpecialDate } from './memory.ts';
import { nextOccurrence } from './remind.ts';
import { todayInTZ } from './skills.ts';

// Same guard as remind.ts/agent.ts: crisis language is a human emergency,
// never a note to hold. Returning null lets the crisis nodes own the message.
const CRISIS_RX =
  /\b(die|dying|death|kill|suicide|suicidal|hurt (?:myself|me)|harm (?:myself|me)|self.?harm|end (?:it all|my life)|give up on (?:life|living)|not (?:want|worth) (?:to live|living)|disappear forever)\b/i;

const NAVI_TZ = 'Africa/Johannesburg';
const MAX_DATES = 8;

const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

export interface DatesTurn { reply: string; profile?: Profile }

function isoFromYMD(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/** Strip the "hey navi" address and trailing punctuation, lowercase. */
function tidy(message: string): string {
  return message
    .trim()
    .toLowerCase()
    .replace(/^\s*(?:hey|hi|hello|yo)?[,\s]*navi[,:\s]+/, '')
    .replace(/[.!?]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Parse a whole-string month/day date: "on the 3rd of august", "3 august",
 * "august 3", "on june 20". Returns null when the string isn't a clean date;
 * an impossible day (29 february, 31 april) comes back as `bad` so the
 * caller can refuse honestly instead of shrugging.
 */
export function parseMonthDay(s: string): { month: number; day: number; bad?: boolean } | null {
  const t = s.trim().toLowerCase().replace(/^on\s+/, '').replace(/^the\s+/, '');
  const m =
    t.match(new RegExp(String.raw`^(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?(${MONTHS.join('|')})$`)) ??
    t.match(new RegExp(String.raw`^(${MONTHS.join('|')})\s+(?:the\s+)?(\d{1,2})(?:st|nd|rd|th)?$`));
  if (!m) return null;
  const [a, b] = [m[1], m[2]];
  const day = /^\d/.test(a) ? parseInt(a, 10) : parseInt(b, 10);
  const month = MONTHS.indexOf(/^\d/.test(a) ? b : a) + 1;
  if (day < 1 || day > DAYS_IN_MONTH[month - 1]) return { month, day, bad: true };
  return { month, day };
}

/** "3 august" — how a special date reads back. */
export function dateLabel(d: { month: number; day: number }): string {
  return `${d.day} ${MONTHS[d.month - 1]}`;
}

// "my mom's birthday is on 3 august" / "sarah's birthday is 12 march".
// The user's OWN birthday never matches — "my birthday is …" has no
// possessive before the word, so it stays memory.ts's field.
const ADD_BDAY_RX = /^(?:my |our )?(.{2,24}?)['’]?s birthday is (?:on |coming up on )?(.+)$/;
// "our wedding anniversary is 20 june" / "my parents' anniversary is on 1 may".
const ADD_ANNIV_RX = /^(?:my |our )(?:(.{2,24}?) )?anniversary is (?:on |coming up on )?(.+)$/;

// "when is my mom's birthday" / "when is our anniversary". A bare
// "when is my birthday" leaves `who` empty and steps aside for memory.ts.
const WHEN_RX = /^when(?:'s| is) (?:my |our )?(?:(.{2,30}?)['’]?s )?(birthday|anniversary)(?: again)?$/;

const LIST_RX =
  /^(?:(?:what|which) special (?:dates|days) (?:do i have|am i tracking|do you (?:have|know))|(?:show|list)(?: me)? my special (?:dates|days)|what are my special (?:dates|days))$/;

// "forget my mom's birthday". A bare "forget my birthday" leaves `who`
// empty and steps aside — that's memory.ts's field-forget.
const FORGET_RX = /^(?:forget|remove|delete) (?:my |our )?(?:(.{2,30}?)['’]?s )?(birthday|anniversary)$/;
const CLEAR_RX = /^(?:clear|forget|delete|remove) (?:all )?(?:of )?my special (?:dates|days)$/;

/** True when the message is a special-dates ask (used to nudge anonymous users to sign in). */
export function isDatesAsk(message: string): boolean {
  const t = tidy(message);
  if (LIST_RX.test(t) || CLEAR_RX.test(t)) return true;
  const when = t.match(WHEN_RX);
  if (when?.[1]) return true;
  const bday = t.match(ADD_BDAY_RX);
  if (bday && parseMonthDay(bday[2])) return true;
  const anniv = t.match(ADD_ANNIV_RX);
  if (anniv && parseMonthDay(anniv[2])) return true;
  return false;
}

function findDate(list: SpecialDate[], asked: string): SpecialDate | undefined {
  const a = asked.toLowerCase().trim();
  return list.find((d) => d.what === a || d.what.includes(a) || a.includes(d.what));
}

/** "in 19 days" / "tomorrow" / "TODAY" — days until the next occurrence. */
function countdown(d: SpecialDate, today: { y: number; m: number; d: number }): { days: number; label: string } {
  const todayISO = isoFromYMD(today.y, today.m, today.d);
  const next = nextOccurrence({ month: d.month, day: d.day }, today);
  const days = Math.round((Date.parse(next) - Date.parse(todayISO)) / 86400000);
  const label = days === 0 ? "that's TODAY" : days === 1 ? "that's tomorrow" : `in ${days} days`;
  return { days, label };
}

function badDateReply(month: number, day: number): string {
  const name = MONTHS[month - 1];
  const why = month === 2 && day === 29
    ? '29 february only exists in leap years — pick 28 february or 1 march and it lands every year'
    : `${name} doesn't have a ${day}${day % 10 === 1 && day !== 11 ? 'st' : day % 10 === 2 && day !== 12 ? 'nd' : day % 10 === 3 && day !== 13 ? 'rd' : 'th'} — pick a real ${name} day`;
  return `I can't hold that one: ${why}.`;
}

/**
 * Handle a special-dates ask against the stored profile. Returns null when
 * the message isn't about the dates book; otherwise the reply, plus the
 * updated profile when the book changed (the caller persists it).
 */
export function tryDates(message: string, stored: Profile, today = todayInTZ(NAVI_TZ)): DatesTurn | null {
  const t = tidy(message);
  const list = stored.dates ?? [];

  if (LIST_RX.test(t)) {
    if (!list.length) {
      return { reply: 'No special dates in the book yet. Tell me one — "my mom\'s birthday is on 3 august" — and I\'ll hold it every year.' };
    }
    const sorted = [...list].sort((a, b) => countdown(a, today).days - countdown(b, today).days);
    const lines = sorted.map((d) => {
      const { label } = countdown(d, today);
      return `• your ${d.what} — ${dateLabel(d)} (${label})`;
    });
    return { reply: `The special dates I'm holding for you:\n${lines.join('\n')}\n\nI'll give you a heads-up the day before and on the day itself.` };
  }

  if (CLEAR_RX.test(t)) {
    if (!list.length) return { reply: 'The special-dates book is already empty.' };
    return {
      reply: `Done — all ${list.length} special date${list.length > 1 ? 's' : ''} cleared from the book.`,
      profile: { ...stored, dates: [] },
    };
  }

  const when = t.match(WHEN_RX);
  if (when) {
    // A bare "when is my birthday" is the user's own — memory.ts owns it.
    if (!when[1] && when[2] === 'birthday') return null;
    const asked = when[1] ? `${when[1]}'s ${when[2]}` : when[2];
    const hit = findDate(list, asked) ?? (when[1] ? findDate(list, when[1]) : findDate(list, 'anniversary'));
    if (!hit) {
      return { reply: `I don't have that date saved yet. Tell me — "${when[1] ?? 'sarah'}'s ${when[2]} is on 12 march" — and I'll hold it every year.` };
    }
    const { label } = countdown(hit, today);
    return { reply: `Your ${hit.what} is on ${dateLabel(hit)} — ${label}. It's in the book; I'll remind you when it's close.` };
  }

  const forget = t.match(FORGET_RX);
  if (forget) {
    // A bare "forget my birthday" is the user's own field — memory.ts owns it.
    if (!forget[1] && forget[2] === 'birthday') return null;
    const asked = forget[1] ? `${forget[1]}'s ${forget[2]}` : forget[2];
    const hit = findDate(list, asked) ?? (forget[1] ? findDate(list, forget[1]) : findDate(list, 'anniversary'));
    if (!hit) {
      return { reply: `I didn't have that date saved, so there's nothing to forget. Say "what special dates do i have" to see the book.` };
    }
    const rest = list.filter((d) => d !== hit);
    return {
      reply: `Forgotten — your ${hit.what} is out of the book. ${rest.length ? `${rest.length} still held.` : 'The book is empty now.'}`,
      profile: { ...stored, dates: rest },
    };
  }

  // Adds last — and crisis phrasing is never stored as a date.
  let what = '';
  let tail = '';
  const bday = t.match(ADD_BDAY_RX);
  const anniv = bday ? null : t.match(ADD_ANNIV_RX);
  if (bday) {
    const who = bday[1].trim().replace(/^(?:the|a|an)\s+/, '');
    if (who.length < 2 || /^(?:the|a|an|it|that|this)$/.test(who)) return null;
    what = `${who}'s birthday`;
    tail = bday[2];
  } else if (anniv) {
    const qual = anniv[1]?.trim();
    what = qual ? `${qual} anniversary` : 'anniversary';
    tail = anniv[2];
  } else {
    return null;
  }

  if (CRISIS_RX.test(message)) return null;
  const md = parseMonthDay(tail);
  if (!md) return null; // "my mom's birthday is always chaotic" stays conversation
  if (md.bad) return { reply: badDateReply(md.month, md.day) };

  const existing = findDate(list, what);
  const rest = existing ? list.filter((d) => d !== existing) : list;
  if (!existing && rest.length >= MAX_DATES) {
    return { reply: `The book is full (${MAX_DATES} dates). Say "what special dates do i have" and drop one first — "forget my mom's birthday".` };
  }
  const entry: SpecialDate = { what, month: md.month, day: md.day };
  const { label } = countdown(entry, today);
  const verb = existing ? `Updated — your ${what} is now` : `In the book — your ${what} is`;
  return {
    reply: `${verb} ${dateLabel(entry)}, ${label}. I'll hold it every year and give you a heads-up when it's close.`,
    profile: { ...stored, dates: [...rest, entry] },
  };
}

/**
 * Open the first reply of a session with special-date heads-ups: anything
 * landing TODAY gets a celebration line, anything landing TOMORROW gets a
 * warning shot. One note per day per date (the `noted` stamp rides the
 * returned list into the end-of-request save) — and a yearly date is never
 * released; next year it speaks again. Never wraps a crisis reply.
 */
export function addDateHeadsUps(
  response: string,
  stored: Profile,
  today = todayInTZ(NAVI_TZ),
): { response: string; dates?: SpecialDate[] } {
  const list = stored.dates ?? [];
  if (!list.length || isCrisisReply(response)) return { response };
  const todayISO = isoFromYMD(today.y, today.m, today.d);

  const parts: string[] = [];
  let stamped = false;
  const dates = list.map((d) => {
    if (d.noted === todayISO) return d;
    const { days } = countdown(d, today);
    if (days === 0) {
      parts.push(`It's your ${d.what} TODAY — don't let it slip by.`);
    } else if (days === 1) {
      parts.push(`Heads up: your ${d.what} is TOMORROW (${dateLabel(d)}).`);
    } else {
      return d;
    }
    stamped = true;
    return { ...d, noted: todayISO };
  });
  if (!parts.length) return { response };
  return {
    response: `${parts.join(' ')}\n\n${response}`,
    ...(stamped ? { dates } : {}),
  };
}
