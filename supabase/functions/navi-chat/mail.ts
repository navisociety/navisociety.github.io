// supabase/functions/navi-chat/mail.ts
//
// NAVI v32 — The email bridge: NAVI executes REAL tasks.
// NAVI v33 — The correspondence round: NAVI reads, replies, and books sends.
//
//   "check my inbox" / "any new emails?"            → the 5 newest inbox mails
//   "reply to the last email from sam [saying …]"   → a real Re: draft +
//        the send offer, addressed to the actual sender (the inbox is read
//        by NAME on purpose — a literal address in chat is intercepted by
//        the locked client before it ever reaches this function)
//   "send draft 2 tomorrow morning"                 → a BOOKED send: confirmed
//        now (two-step, same law as v32), fired by the first session after
//        the time passes — NAVI only speaks when spoken to, so there is no
//        cron and nothing happens behind the user's back
//   "show my scheduled sends" / "cancel the scheduled send" manage the book
//
// Reading is the only new power that needs no confirm (it changes nothing);
// everything that SENDS still goes through the v32 two-step confirm, and a
// booked send re-reads its draft at fire time exactly like an immediate one.
//
// The third cross-platform bridge (vision.ts → chats.ts → mail.ts), and the
// first one whose action leaves the platform entirely: NAVI drafts, lists,
// deletes and — after an explicit yes — actually SENDS email through the
// user's connected Gmail account. Same navi_emails table the Email tool
// renders, same navi_gmail_tokens row the tool's Connect button fills.
//
//   "draft an email to me about the studio schedule"      → a real draft row
//   "draft an email to sam@x.com about friday saying …"   → recipient + body
//   "list my email drafts"                                → numbered, newest first
//   "delete email draft 2"                                → removes that draft
//   "send draft 2"                                        → two-step: NAVI reads
//        the recipient + subject back and waits for an explicit yes
//
// Sending is the most REAL thing NAVI does — a wrong send can't be unsent —
// so it reuses the v31 two-step confirm pattern from chats.ts: the offer is
// stamped on the profile (Profile.mailSend), a bare "yes" only counts while
// the offer is fresh (10 minutes), the draft is RE-READ at execute time (a
// draft edited or deleted in the Email tool meanwhile is never mis-sent), and
// every failure mode gets an honest reply — "Gmail isn't connected", never a
// silent shrug.
//
// Note on the client: App.tsx intercepts signed-in messages that carry a
// literal address + an intent verb and creates the draft itself (email-in-chat,
// v45 — UI is locked). This bridge is the address-free + server-side half:
// "send draft 2", "list my email drafts", "email me about…", and every
// workflow step (answerIntent never passes through the client intercept, so
// "draft an email to me about *" works inside a saved routine).
//
// Safety rails, same law as the rest of the agentic layer:
//   - anchored, conservative parsing; null means "not my business".
//   - crisis language is never a subject or body (CRISIS_RX).
//   - signed-in only — drafts and the Gmail connection are keyed by email.
//   - NAVI only sends to ONE recipient per ask, only from drafts the user can
//     see in the Email tool, and never composes a send without the confirm.
//   - the draft shelf is capped (20) — every list needs a cap.

import type { MailSend, Profile, ScheduledSend } from './memory.ts';
import { todayInTZ } from './skills.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const GOOGLE_CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? '';
const GOOGLE_CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '';

const authHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
};

const MAX_DRAFTS = 20; // the shelf cap — the Email tool can hold more; chat won't pile higher
const MAX_SUBJECT = 120;
const MAX_BODY = 1500;
const CONFIRM_WINDOW_MS = 10 * 60 * 1000; // a bare "yes" must be this fresh
const MAX_SCHEDULED = 3;  // v33: the booking cap — every list needs a cap
const INBOX_PEEK = 5;     // v33: how many inbox mails a read shows
const SA_OFFSET_HOURS = 2; // SAST is UTC+2 year-round — no DST to chase
const NAVI_TZ = 'Africa/Johannesburg';

// Same guard as agent.ts/vision.ts: crisis language is a human emergency,
// never something to put in an envelope.
const CRISIS_RX =
  /\b(die|dying|death|kill|suicide|suicidal|hurt (?:myself|me)|harm (?:myself|me)|self.?harm|end (?:it all|my life)|give up on (?:life|living)|not (?:want|worth) (?:to live|living)|disappear forever)\b/i;

function tidy(message: string): string {
  return message
    .toLowerCase()
    .replace(/^\s*(?:hey|hi|hello|yo)?[,\s]*navi[,:\s]+/, '')
    .replace(/[.!?]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Command parsing ─────────────────────────────────────────────────────────

const ADDRESS_RX = /^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$/;

// "draft an email to me about the studio schedule [saying …]" — the verb
// "send" flags that the user wants it sent, which stamps the confirm offer
// right after the draft lands (still never sends without the yes).
const DRAFT_RX =
  /^(?:please )?(draft|write|compose|prepare|send)(?: me)? (?:an |a )?e?mail to (me|myself|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}) (?:about|regarding|re|titled|with subject) (.+)$/;

const BODY_SPLIT_RX = /^(.{2,}?) (?:saying|that says|with body) (.+)$/;

const LIST_RX =
  /^(?:please )?(?:list|show)(?: me)?(?: all)?(?: my)? e?mail drafts$|^what e?mail drafts do i have$/;

const DELETE_RX =
  /^(?:please )?(?:delete|remove|discard|scrap) (?:e?mail )?draft (\d{1,2})$/;

const SEND_RX = /^(?:please )?send (?:e?mail )?draft (\d{1,2})$/;

// v33: "send draft 2 tomorrow morning" — the number plus a time phrase. The
// phrase is parsed by parseSendWhen against a CLOSED vocabulary; anything it
// doesn't know gets the vocabulary taught back, never a guess.
const SEND_LATER_RX = /^(?:please )?send (?:e?mail )?draft (\d{1,2}) (.+)$/;

// v33: inbox reads. Reading changes nothing, so no confirm — but it's still
// anchored to whole, unmistakable asks.
const INBOX_RX =
  /^(?:please )?(?:check|read|open|show(?: me)?|list)(?: my| the)? (?:e?mail )?inbox$|^(?:any|do i have(?: any)?) new e?mails?$|^check my e?mail$|^what'?s in my inbox$/;

// v33: "reply to the last email from sam [saying …]". By NAME on purpose:
// the locked client (App.tsx) intercepts any chat message carrying a literal
// address + an email verb, so the address form can never reach this function
// from the chat box (workflow steps still can — answerIntent skips the client).
const REPLY_RX =
  /^(?:please )?reply to (?:the )?(?:last|latest|most recent|newest) e?mail from (.+)$/;

// v33: the booking shelf. List and cancel are profile-only moves.
const SCHED_LIST_RX =
  /^(?:please )?(?:list|show)(?: me)?(?: my| the)? scheduled (?:sends?|e?mails?)$|^what e?mails? (?:are|is) scheduled$/;
const SCHED_CANCEL_RX =
  /^(?:please )?cancel (?:the |my )?scheduled send(?: (\d{1,2}))?$|^unschedule (?:e?mail )?draft (\d{1,2})$/;

// Confirmations. Bare forms only count while the offer is fresh; the
// mail-explicit forms work as long as the stamp exists. NOTE the pipeline
// runs tryChats BEFORE tryMail — a pending chat cleanup consumes bare
// yes/no first, so two fresh offers never race (deterministic order).
const CONFIRM_BARE_RX = /^(?:yes|yes please|yep|yeah|do it|go ahead|confirm)$/;
const CONFIRM_EXPLICIT_RX = /^(?:yes,? )?send (?:it|the e?mail)$|^confirm (?:the )?(?:e?mail )?send$/;

const CANCEL_BARE_RX = /^(?:no|nope|don'?t|never ?mind)$/;
const CANCEL_EXPLICIT_RX = /^(?:cancel|don'?t send)(?: (?:the )?(?:e?mail|send)| it)?$/;

export type MailDraftAsk = { to: string; subject: string; body?: string; wantSend: boolean };

/** A "draft/send an email to X about Y" ask, or null. Crisis-guarded. */
export function parseMailDraft(message: string): MailDraftAsk | null {
  const t = tidy(message);
  if (!t || t.length > 400) return null;
  const m = t.match(DRAFT_RX);
  if (!m) return null;
  const to = m[2].trim();
  let subject = m[3].trim();
  let body: string | undefined;
  const split = subject.match(BODY_SPLIT_RX);
  if (split) {
    subject = split[1].trim();
    body = split[2].trim().slice(0, MAX_BODY);
  }
  if (!subject || CRISIS_RX.test(subject) || (body && CRISIS_RX.test(body))) return null;
  return { to, subject: subject.slice(0, MAX_SUBJECT), body, wantSend: m[1] === 'send' };
}

/** True for a "list my email drafts" read ask. */
export function isDraftListAsk(message: string): boolean {
  const t = tidy(message);
  return !!t && LIST_RX.test(t);
}

/** The draft number from a "delete email draft N" ask, or null. */
export function parseDraftDelete(message: string): number | null {
  const t = tidy(message);
  if (!t || t.length > 60) return null;
  const m = t.match(DELETE_RX);
  return m ? parseInt(m[1], 10) : null;
}

/** The draft number from a "send draft N" ask, or null. */
export function parseDraftSend(message: string): number | null {
  const t = tidy(message);
  if (!t || t.length > 60) return null;
  const m = t.match(SEND_RX);
  return m ? parseInt(m[1], 10) : null;
}

/** v33: the draft number + raw time phrase from "send draft N <when>", or null. */
export function parseDraftSendLater(message: string): { n: number; when: string } | null {
  const t = tidy(message);
  if (!t || t.length > 80) return null;
  const m = t.match(SEND_LATER_RX);
  return m ? { n: parseInt(m[1], 10), when: m[2].trim() } : null;
}

/** v33: true for a "check my inbox" / "any new emails" read ask. */
export function isInboxAsk(message: string): boolean {
  const t = tidy(message);
  return !!t && t.length <= 60 && INBOX_RX.test(t);
}

export type MailReplyAsk = { from: string; body?: string };

/** v33: a "reply to the last email from X [saying …]" ask, or null. Crisis-guarded. */
export function parseMailReply(message: string): MailReplyAsk | null {
  const t = tidy(message);
  if (!t || t.length > 400) return null;
  const m = t.match(REPLY_RX);
  if (!m) return null;
  let from = m[1].trim();
  let body: string | undefined;
  const split = from.match(BODY_SPLIT_RX);
  if (split) {
    from = split[1].trim();
    body = split[2].trim().slice(0, MAX_BODY);
  }
  if (!from || from.length > 60) return null;
  if (CRISIS_RX.test(from) || (body && CRISIS_RX.test(body))) return null;
  return { from, body };
}

/** v33: true for a "show my scheduled sends" read ask. */
export function isScheduledListAsk(message: string): boolean {
  const t = tidy(message);
  return !!t && t.length <= 60 && SCHED_LIST_RX.test(t);
}

/**
 * v33: a "cancel the scheduled send [N]" ask. Returns the 1-based booking
 * number, 0 when no number was given (the caller resolves it), or null when
 * the message isn't a cancel ask.
 */
export function parseScheduledCancel(message: string): number | null {
  const t = tidy(message);
  if (!t || t.length > 60) return null;
  const m = t.match(SCHED_CANCEL_RX);
  if (!m) return null;
  const n = m[1] ?? m[2];
  return n ? parseInt(n, 10) : 0;
}

// ── v33: the time vocabulary (closed, SA time, deterministic) ───────────────

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const TOD_HOURS: Record<string, number> = { morning: 8, afternoon: 14, evening: 18, night: 18 };

const WHEN_WEEKDAY_RX = new RegExp(
  `^(?:on |next )?(${WEEKDAYS.join('|')})(?: (morning|afternoon|evening|night))?$`,
);

/** UTC ms for an SA-time hour on today+dayOffset. */
function saStamp(today: { y: number; m: number; d: number }, dayOffset: number, hour: number): number {
  return Date.UTC(today.y, today.m - 1, today.d + dayOffset, hour - SA_OFFSET_HOURS);
}

/**
 * v33: parse a send-time phrase. Returns the ISO datetime it means, 'now' for
 * an explicit right-away, 'past' when the phrase names a moment already gone,
 * or null when the phrase isn't in the vocabulary (the caller teaches it).
 */
export function parseSendWhen(
  rest: string,
  now = Date.now(),
  today = todayInTZ(NAVI_TZ),
): string | 'now' | 'past' | null {
  const t = rest.trim().toLowerCase().replace(/[.!?]+\s*$/, '');
  if (!t) return null;
  if (/^(?:now|right now|immediately|straight away)$/.test(t)) return 'now';

  let at = NaN;
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^in (\d{1,2}) hours?$/))) {
    at = now + parseInt(m[1], 10) * 3600_000;
  } else if ((m = t.match(/^in (\d{1,3}) min(?:ute)?s?$/))) {
    at = now + parseInt(m[1], 10) * 60_000;
  } else if (/^(?:tonight|this evening)$/.test(t)) {
    at = saStamp(today, 0, TOD_HOURS.evening);
  } else if ((m = t.match(/^tomorrow(?: (morning|afternoon|evening|night))?$/))) {
    at = saStamp(today, 1, TOD_HOURS[m[1] ?? 'morning']);
  } else if ((m = t.match(/^tomorrow at (\d{1,2})\s*(am|pm)$/))) {
    const h = parseInt(m[1], 10);
    if (h < 1 || h > 12) return null;
    at = saStamp(today, 1, (h % 12) + (m[2] === 'pm' ? 12 : 0));
  } else if ((m = t.match(WHEN_WEEKDAY_RX))) {
    const target = WEEKDAYS.indexOf(m[1]);
    const dow = new Date(Date.UTC(today.y, today.m - 1, today.d)).getUTCDay();
    const ahead = ((target - dow) % 7 + 7) % 7 || 7; // "friday" said on a Friday means next Friday
    at = saStamp(today, ahead, TOD_HOURS[m[2] ?? 'morning']);
  } else {
    return null;
  }
  if (!Number.isFinite(at)) return null;
  return at <= now ? 'past' : new Date(at).toISOString();
}

/** "Wed 2026-07-15, 08:00 SA time" from a stored ISO datetime. */
function humanTime(iso: string): string {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return iso;
  const sa = new Date(ms + SA_OFFSET_HOURS * 3600_000);
  const dow = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][sa.getUTCDay()];
  return `${dow} ${sa.toISOString().slice(0, 10)}, ${sa.toISOString().slice(11, 16)} SA time`;
}

// ── The drafts shelf, over PostgREST ────────────────────────────────────────

type DraftRow = { id: string; recipient: string; subject: string; body: string; created_at: string };

/** All of a user's drafts, newest first (the Email tool's order) — or null when unreachable. */
async function listDrafts(email: string): Promise<DraftRow[] | null> {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  try {
    const url = `${SUPABASE_URL}/rest/v1/navi_emails` +
      `?user_email=eq.${encodeURIComponent(email)}&status=eq.draft` +
      `&select=id,recipient,subject,body,created_at&order=created_at.desc&limit=100`;
    const res = await fetch(url, { headers: authHeaders, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

/** Insert a draft row. The created row on success, null when unreachable. */
async function insertDraft(
  email: string,
  to: string,
  subject: string,
  body: string,
): Promise<DraftRow | null> {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/navi_emails`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json', Prefer: 'return=representation' },
      body: JSON.stringify([{ user_email: email, recipient: to, subject, body, status: 'draft' }]),
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) && rows[0] ? rows[0] as DraftRow : null;
  } catch {
    return null;
  }
}

/** Delete one draft by id (scoped to the user). True on success. */
async function deleteDraft(email: string, id: string): Promise<boolean> {
  if (!SUPABASE_URL || !SERVICE_KEY) return false;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/navi_emails?id=eq.${encodeURIComponent(id)}` +
        `&user_email=eq.${encodeURIComponent(email)}&status=eq.draft`,
      { method: 'DELETE', headers: authHeaders, signal: AbortSignal.timeout(4000) },
    );
    return res.ok;
  } catch {
    return false;
  }
}

/** Re-read one draft by id at execute time — 'gone' when it no longer exists as a draft. */
async function getDraft(email: string, id: string): Promise<DraftRow | 'gone' | null> {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  try {
    const url = `${SUPABASE_URL}/rest/v1/navi_emails` +
      `?id=eq.${encodeURIComponent(id)}&user_email=eq.${encodeURIComponent(email)}` +
      `&status=eq.draft&select=id,recipient,subject,body,created_at`;
    const res = await fetch(url, { headers: authHeaders, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const rows = await res.json();
    if (!Array.isArray(rows)) return null;
    return rows[0] ? rows[0] as DraftRow : 'gone';
  } catch {
    return null;
  }
}

async function markSent(email: string, id: string): Promise<void> {
  try {
    await fetch(
      `${SUPABASE_URL}/rest/v1/navi_emails?id=eq.${encodeURIComponent(id)}` +
        `&user_email=eq.${encodeURIComponent(email)}`,
      {
        method: 'PATCH',
        headers: { ...authHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ status: 'sent', sent_at: new Date().toISOString(), updated_at: new Date().toISOString() }),
        signal: AbortSignal.timeout(4000),
      },
    );
  } catch { /* the send already happened — status is cosmetic, never re-send */ }
}

// ── Gmail (same OAuth row + MIME shape as the navi-email function) ──────────

type GmailToken = { token: string; from: string };

/** A live access token + the sending address, 'not-connected', or null when unreachable. */
async function gmailToken(email: string): Promise<GmailToken | 'not-connected' | null> {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  try {
    const url = `${SUPABASE_URL}/rest/v1/navi_gmail_tokens` +
      `?user_email=eq.${encodeURIComponent(email)}` +
      `&select=access_token,refresh_token,expires_at,gmail_address`;
    const res = await fetch(url, { headers: authHeaders, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const rows = await res.json();
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return 'not-connected';
    const from = row.gmail_address || email;
    if (new Date(row.expires_at).getTime() - Date.now() >= 120_000) {
      return { token: row.access_token, from };
    }
    // Token stale — refresh it, exactly as navi-email does.
    if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) return 'not-connected';
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: row.refresh_token,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        grant_type: 'refresh_token',
      }),
      signal: AbortSignal.timeout(6000),
    });
    if (!r.ok) return 'not-connected';
    const d = await r.json();
    const expiresAt = new Date(Date.now() + d.expires_in * 1000).toISOString();
    await fetch(
      `${SUPABASE_URL}/rest/v1/navi_gmail_tokens?user_email=eq.${encodeURIComponent(email)}`,
      {
        method: 'PATCH',
        headers: { ...authHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
        body: JSON.stringify({ access_token: d.access_token, expires_at: expiresAt, updated_at: new Date().toISOString() }),
        signal: AbortSignal.timeout(4000),
      },
    ).catch(() => {});
    return { token: d.access_token, from };
  } catch {
    return null;
  }
}

function toB64url(s: string): string {
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function buildMime(to: string, from: string, subject: string, body: string): string {
  const mime = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    '',
    body,
  ].join('\r\n');
  return toB64url(mime);
}

/** The real send. True only when Gmail accepted the message. */
async function sendViaGmail(g: GmailToken, draft: DraftRow): Promise<boolean> {
  try {
    const res = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST',
      headers: { Authorization: `Bearer ${g.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ raw: buildMime(draft.recipient, g.from, draft.subject, draft.body) }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// ── v33: the inbox read (metadata only — NAVI reads, it never deletes) ──────

type InboxMsg = { id: string; from: string; subject: string; date: string };

function hdr(headers: Array<{ name: string; value: string }> | undefined, name: string): string {
  return (headers ?? []).find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

/** The newest inbox mails matching a Gmail query — or null when unreachable. */
async function searchInbox(g: GmailToken, query: string, max: number): Promise<InboxMsg[] | null> {
  try {
    const listRes = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${max}&q=${encodeURIComponent(query)}`,
      { headers: { Authorization: `Bearer ${g.token}` }, signal: AbortSignal.timeout(6000) },
    );
    if (!listRes.ok) return null;
    const list = await listRes.json();
    const ids: Array<{ id: string }> = Array.isArray(list.messages) ? list.messages : [];
    const details = await Promise.all(ids.map((m) =>
      fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${g.token}` }, signal: AbortSignal.timeout(6000) },
      ).then((r) => (r.ok ? r.json() : null)).catch(() => null)
    ));
    return details
      .filter((msg) => msg && msg.id)
      .map((msg) => ({
        id: msg.id as string,
        from: hdr(msg.payload?.headers, 'From'),
        subject: hdr(msg.payload?.headers, 'Subject'),
        date: hdr(msg.payload?.headers, 'Date'),
      }));
  } catch {
    return null;
  }
}

/** The bare address out of a From header ("Sam <sam@x.com>" → sam@x.com), or ''. */
function fromAddress(from: string): string {
  const angled = from.match(/<([^>]+)>/);
  const candidate = (angled ? angled[1] : from).trim().toLowerCase();
  return ADDRESS_RX.test(candidate) ? candidate : '';
}

/** The human half of a From header ("Sam Smith <sam@x.com>" → Sam Smith), or the address. */
function fromName(from: string): string {
  const name = from.replace(/<[^>]*>/, '').replace(/"/g, '').trim();
  return name || from.trim();
}

// ── Replies ─────────────────────────────────────────────────────────────────

const UNREACHABLE =
  "I couldn't reach your email drafts just now — the command was clear, the connection wasn't. Try me again in a moment.";

const SIGN_IN_REPLY =
  'Email lives in your account, so I can only handle it once you\'re signed in. Sign in and tell me again — then "draft an email to me about …" and "send draft 1" both work.';

const NOT_CONNECTED_REPLY =
  'The draft is safe, but Gmail isn\'t connected, and I only send through YOUR account — never around it. Open Email in the Tools menu, tap Connect Gmail, then tell me "send it" again.';

function sentenceCase(s: string): string {
  const t = s.trim();
  const capped = t.charAt(0).toUpperCase() + t.slice(1);
  return /[.!?]$/.test(capped) ? capped : `${capped}.`;
}

/** The deterministic body used when the ask names only a subject. */
function defaultBody(subject: string, profile: Profile): string {
  const signoff = profile.name ? `— ${profile.name}` : '— sent with NAVI';
  return `Hi,\n\n${sentenceCase(subject)}\n\n${signoff}`;
}

function draftLabel(d: DraftRow): string {
  return `to ${d.recipient || '(no recipient)'} — "${d.subject || '(no subject)'}"`;
}

function draftLines(drafts: DraftRow[]): string {
  return drafts.map((d, i) => `${i + 1}. ${draftLabel(d)}`).join('\n');
}

function sendOffer(to: string, subject: string): string {
  return `Ready to send "${subject}" to ${to} — a real email, from your Gmail, and there's no unsending it.\n\nSay "yes, send it" and it goes, or "no" to keep it as a draft.`;
}

// v33: the booked-send offer — same two-step law, but the yes books instead
// of firing.
function scheduleOffer(to: string, subject: string, sendAtISO: string): string {
  return `Ready to book "${subject}" to ${to} for ${humanTime(sendAtISO)}. I only act when we're talking, so it goes out with the first thing you say to me after that moment — a real email, from your Gmail, no unsending it.\n\nSay "yes" to book it, or "no" to leave it as a plain draft.`;
}

const NOT_CONNECTED_READ =
  'I can only read your inbox through YOUR Gmail, and it isn\'t connected yet. Open Email in the Tools menu, tap Connect Gmail, then ask me again.';

const UNREACHABLE_INBOX =
  "I couldn't reach your inbox just now — the command was clear, the connection wasn't. Try me again in a moment.";

const WHEN_VOCAB =
  'I can book that, but I didn\'t recognise the time. I know: "now", "in 2 hours", "in 30 minutes", "tonight", "tomorrow", "tomorrow morning/afternoon/evening", "tomorrow at 9am", and "on friday [morning]". Try "send draft N tomorrow morning".';

/** v33: the deterministic body used when a reply ask names no "saying …". */
function defaultReplyBody(src: InboxMsg, profile: Profile): string {
  const first = fromName(src.from).split(/\s+/)[0]?.replace(/[^a-zA-Z'-]/g, '') ?? '';
  const opener = first && !first.includes('@') ? `Hi ${first},` : 'Hi,';
  const about = src.subject ? ` about "${src.subject.slice(0, 80)}"` : '';
  const signoff = profile.name ? `— ${profile.name}` : '— sent with NAVI';
  return `${opener}\n\nThanks for your email${about} — I got it, and I'll come back to you properly soon.\n\n${signoff}`;
}

function scheduledLines(list: ScheduledSend[], now = Date.now()): string {
  return list.map((s, i) => {
    const due = Date.parse(s.sendAt) <= now ? ' — due now; it fires the next fresh session' : '';
    return `${i + 1}. "${s.subject || '(no subject)'}" to ${s.to} — ${humanTime(s.sendAt)}${due}`;
  }).join('\n');
}

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Handle an email command, or return null when the message isn't mail
 * business. Same contract as tryChats: a profile comes back only when the
 * pending send stamp changes (the caller saves it). Bare "yes"/"no" return
 * null unless a send offer is actually pending — and tryChats runs first in
 * the pipeline, so its cleanup offer always outranks ours on a bare yes.
 */
export async function tryMail(
  message: string,
  email: string,
  profile: Profile,
): Promise<{ reply: string; profile?: Profile } | null> {
  const t = tidy(message);
  if (!t) return null;

  const pending = profile.mailSend;
  const confirmBare = CONFIRM_BARE_RX.test(t);
  const confirmExplicit = CONFIRM_EXPLICIT_RX.test(t);
  const cancelBare = CANCEL_BARE_RX.test(t);
  const cancelExplicit = CANCEL_EXPLICIT_RX.test(t);
  const draftAsk = parseMailDraft(message);
  const listAsk = draftAsk ? false : isDraftListAsk(message);
  const deleteN = draftAsk || listAsk ? null : parseDraftDelete(message);
  // v33: the new asks. All anchored and mutually exclusive with the old ones.
  const inboxAsk = isInboxAsk(message);
  const replyAsk = parseMailReply(message);
  const schedListAsk = isScheduledListAsk(message);
  const schedCancel = parseScheduledCancel(message);
  const later = draftAsk || listAsk || deleteN !== null ? null : parseDraftSendLater(message);
  let sendN = draftAsk || listAsk || deleteN !== null || later ? null : parseDraftSend(message);
  // "send draft 2 <when>": resolve the phrase now — "now" collapses into the
  // immediate path, an unknown phrase teaches, a booked one carries its time.
  let laterAt: string | null = null;
  let laterProblem: 'vocab' | 'past' | null = null;
  if (later) {
    const when = parseSendWhen(later.when);
    if (when === 'now') sendN = later.n;
    else if (when === 'past') laterProblem = 'past';
    else if (when === null) laterProblem = 'vocab';
    else laterAt = when;
  }

  const anyAsk = !!draftAsk || listAsk || deleteN !== null || sendN !== null ||
    laterAt !== null || laterProblem !== null || inboxAsk || !!replyAsk ||
    schedListAsk || schedCancel !== null;

  // Bare yes/no with nothing pending is ordinary conversation — not ours.
  if (!pending && (confirmBare || cancelBare) && !confirmExplicit && !cancelExplicit) {
    return null;
  }
  if (!anyAsk && !confirmExplicit && !cancelExplicit && !(pending && (confirmBare || cancelBare))) {
    return null;
  }

  if (!email) return { reply: SIGN_IN_REPLY };

  // ── Confirm / cancel a pending send ───────────────────────────────────────
  if (pending && (confirmBare || confirmExplicit || cancelBare || cancelExplicit) && !anyAsk) {
    const cleared: Profile = { ...profile };
    delete cleared.mailSend;
    if (cancelBare || cancelExplicit) {
      return { reply: `Kept as a draft — nothing was sent. "${pending.subject}" is still on the shelf whenever you're ready.`, profile: cleared };
    }
    const fresh = Date.now() - Date.parse(pending.asked) <= CONFIRM_WINDOW_MS;
    if (confirmBare && !confirmExplicit && !fresh) {
      return {
        reply: 'That send offer went stale, so I won\'t put a real email in the world on a bare "yes" this long after asking. Say "send draft N" again and I\'ll read it back first.',
        profile: cleared,
      };
    }
    // v33: a SCHEDULED offer books instead of firing — profile-only, the
    // draft is re-read when the booked moment actually arrives.
    if (pending.sendAt) {
      const scheduled = profile.mailScheduled ?? [];
      if (scheduled.some((s) => s.id === pending.id)) {
        return { reply: `That draft is already booked — "${pending.subject}" is on the schedule. Say "show my scheduled sends" to see it.`, profile: cleared };
      }
      if (scheduled.length >= MAX_SCHEDULED) {
        return { reply: `The schedule is full — ${MAX_SCHEDULED} booked sends is my ceiling. Say "show my scheduled sends" and cancel one first.`, profile: cleared };
      }
      const booked: ScheduledSend = {
        id: pending.id, to: pending.to, subject: pending.subject,
        sendAt: pending.sendAt, created: new Date().toISOString(),
      };
      return {
        reply: `Booked — "${pending.subject}" goes to ${pending.to} with the first thing you say to me after ${humanTime(pending.sendAt)}. "show my scheduled sends" lists the queue; "cancel the scheduled send" unbooks it.`,
        profile: { ...cleared, mailScheduled: [...scheduled, booked] },
      };
    }
    const draft = await getDraft(email, pending.id);
    if (draft === null) return { reply: UNREACHABLE }; // stamp stays — try again
    if (draft === 'gone') {
      return { reply: 'That draft isn\'t on the shelf anymore — it was sent or deleted from the Email tool in the meantime. Nothing went out. Say "list my email drafts" to see what\'s left.', profile: cleared };
    }
    const g = await gmailToken(email);
    if (g === null) return { reply: UNREACHABLE }; // stamp stays — try again
    if (g === 'not-connected') return { reply: NOT_CONNECTED_REPLY }; // stamp stays — connect, then "send it"
    const ok = await sendViaGmail(g, draft);
    if (!ok) return { reply: 'Gmail didn\'t accept the send just now — the draft is untouched. Try "send it" again in a moment.' };
    await markSent(email, draft.id);
    return {
      reply: `Sent — "${draft.subject}" is on its way to ${draft.recipient}. It's in your Sent tab in the Email tool too.`,
      profile: cleared,
    };
  }
  // A mail-explicit confirm/cancel with nothing pending gets pointed the right way.
  if (!pending && (confirmExplicit || cancelExplicit) && !anyAsk) {
    return { reply: 'There\'s no email waiting on a yes. Say "list my email drafts", then "send draft N" — I\'ll read it back and ask before anything real goes out.' };
  }

  // ── "draft an email to … about …" ─────────────────────────────────────────
  if (draftAsk) {
    const to = /^(?:me|myself)$/.test(draftAsk.to) ? email : draftAsk.to;
    if (!ADDRESS_RX.test(to)) {
      return { reply: `"${draftAsk.to}" doesn't look like an email address. Tell me "draft an email to someone@example.com about …" — or "to me" and I'll use ${email}.` };
    }
    const drafts = await listDrafts(email);
    if (drafts === null) return { reply: UNREACHABLE };
    if (drafts.length >= MAX_DRAFTS) {
      return { reply: `The drafts shelf is full — ${MAX_DRAFTS} is my ceiling. Say "delete email draft N" (or clean up in the Email tool) and I'll write it.` };
    }
    const body = draftAsk.body ?? defaultBody(draftAsk.subject, profile);
    const row = await insertDraft(email, to, draftAsk.subject, body);
    if (!row) return { reply: UNREACHABLE };
    if (draftAsk.wantSend) {
      const stamp: MailSend = { id: row.id, to, subject: draftAsk.subject, asked: new Date().toISOString() };
      return {
        reply: `Drafted. ${sendOffer(to, draftAsk.subject)}`,
        profile: { ...profile, mailSend: stamp },
      };
    }
    const bodyNote = draftAsk.body
      ? ''
      : '\n\nI kept the body simple — add "saying …" to your ask to write it yourself, or polish it in the Email tool.';
    return {
      reply: `Drafted ${draftLabel(row)} — it's draft 1 in the Email tool. Say "send draft 1" when you want it to actually go out; I'll always read it back and ask first.${bodyNote}`,
    };
  }

  // ── "list my email drafts" ────────────────────────────────────────────────
  if (listAsk) {
    const drafts = await listDrafts(email);
    if (drafts === null) return { reply: UNREACHABLE };
    if (!drafts.length) {
      return { reply: 'No email drafts on the shelf. Say "draft an email to me about …" and I\'ll write the first one — it shows up in the Email tool too.' };
    }
    return {
      reply: `You have ${drafts.length} email draft${drafts.length === 1 ? '' : 's'}:\n${draftLines(drafts)}\n\nSay "send draft N" to send one (I always confirm first) or "delete email draft N" to drop one.`,
    };
  }

  // ── "delete email draft N" ────────────────────────────────────────────────
  if (deleteN !== null) {
    const drafts = await listDrafts(email);
    if (drafts === null) return { reply: UNREACHABLE };
    if (!drafts.length) return { reply: 'The drafts shelf is already empty — nothing to delete.' };
    if (deleteN < 1 || deleteN > drafts.length) {
      return { reply: `There ${drafts.length === 1 ? 'is only 1 draft' : `are only ${drafts.length} drafts`}:\n${draftLines(drafts)}\n\nPick a number on that list.` };
    }
    const target = drafts[deleteN - 1];
    const ok = await deleteDraft(email, target.id);
    if (!ok) return { reply: UNREACHABLE };
    return { reply: `Deleted draft ${deleteN} (${draftLabel(target)}). ${drafts.length - 1 ? `${drafts.length - 1} draft${drafts.length - 1 === 1 ? '' : 's'} left.` : 'The shelf is clear.'}` };
  }

  // ── "send draft N" — read it back, stamp the offer, wait for the yes ──────
  if (sendN !== null) {
    const drafts = await listDrafts(email);
    if (drafts === null) return { reply: UNREACHABLE };
    if (!drafts.length) return { reply: 'No drafts to send. Say "draft an email to me about …" first, then "send draft 1".' };
    if (sendN < 1 || sendN > drafts.length) {
      return { reply: `There ${drafts.length === 1 ? 'is only 1 draft' : `are only ${drafts.length} drafts`}:\n${draftLines(drafts)}\n\nPick a number on that list.` };
    }
    const target = drafts[sendN - 1];
    if (!ADDRESS_RX.test(target.recipient ?? '')) {
      return { reply: `Draft ${sendN} has no valid recipient yet ("${target.recipient || 'empty'}"). Give it one in the Email tool, then tell me "send draft ${sendN}" again.` };
    }
    const stamp: MailSend = { id: target.id, to: target.recipient, subject: target.subject, asked: new Date().toISOString() };
    return {
      reply: sendOffer(target.recipient, target.subject || '(no subject)'),
      profile: { ...profile, mailSend: stamp },
    };
  }

  // ── v33: "send draft N tomorrow morning" — read it back, stamp a booked offer ─
  if (laterProblem === 'past') {
    return { reply: 'That moment has already passed today, so there\'s nothing to book. Say "send draft N" to send it now, or pick a future time like "tomorrow morning".' };
  }
  if (laterProblem === 'vocab') {
    return { reply: WHEN_VOCAB };
  }
  if (later && laterAt) {
    const scheduled = profile.mailScheduled ?? [];
    if (scheduled.length >= MAX_SCHEDULED) {
      return { reply: `The schedule is full — ${MAX_SCHEDULED} booked sends is my ceiling. Say "show my scheduled sends" and cancel one first.` };
    }
    const drafts = await listDrafts(email);
    if (drafts === null) return { reply: UNREACHABLE };
    if (!drafts.length) return { reply: 'No drafts to book. Say "draft an email to me about …" first, then "send draft 1 tomorrow morning".' };
    if (later.n < 1 || later.n > drafts.length) {
      return { reply: `There ${drafts.length === 1 ? 'is only 1 draft' : `are only ${drafts.length} drafts`}:\n${draftLines(drafts)}\n\nPick a number on that list.` };
    }
    const target = drafts[later.n - 1];
    if (!ADDRESS_RX.test(target.recipient ?? '')) {
      return { reply: `Draft ${later.n} has no valid recipient yet ("${target.recipient || 'empty'}"). Give it one in the Email tool, then book it again.` };
    }
    if (scheduled.some((s) => s.id === target.id)) {
      const existing = scheduled.find((s) => s.id === target.id)!;
      return { reply: `Draft ${later.n} is already booked for ${humanTime(existing.sendAt)}. Say "cancel the scheduled send" first if you want a different time.` };
    }
    const stamp: MailSend = {
      id: target.id, to: target.recipient, subject: target.subject,
      asked: new Date().toISOString(), sendAt: laterAt,
    };
    return {
      reply: scheduleOffer(target.recipient, target.subject || '(no subject)', laterAt),
      profile: { ...profile, mailSend: stamp },
    };
  }

  // ── v33: "show my scheduled sends" — a profile-only read ──────────────────
  if (schedListAsk) {
    const scheduled = profile.mailScheduled ?? [];
    if (!scheduled.length) {
      return { reply: 'Nothing is booked. Say "send draft N tomorrow morning" and I\'ll read it back, ask for a yes, and hold it until the time comes.' };
    }
    return {
      reply: `${scheduled.length} booked send${scheduled.length === 1 ? '' : 's'}:\n${scheduledLines(scheduled)}\n\nEach fires on the first message you send me after its time — say "cancel scheduled send N" to unbook one.`,
    };
  }

  // ── v33: "cancel the scheduled send [N]" — a profile-only unbooking ───────
  if (schedCancel !== null) {
    const scheduled = profile.mailScheduled ?? [];
    // A booking OFFER still waiting on its yes counts too — cancelling it
    // clears the stamp before anything was ever booked.
    if (!scheduled.length && pending?.sendAt) {
      const cleared: Profile = { ...profile };
      delete cleared.mailSend;
      return { reply: `Cancelled — "${pending.subject}" won't be booked. The draft stays on the shelf.`, profile: cleared };
    }
    if (!scheduled.length) {
      return { reply: 'Nothing is booked, so there\'s nothing to cancel. The schedule is clear.' };
    }
    if (schedCancel === 0 && scheduled.length > 1) {
      return { reply: `There are ${scheduled.length} booked sends:\n${scheduledLines(scheduled)}\n\nSay "cancel scheduled send N" so I unbook the right one.` };
    }
    const idx = (schedCancel === 0 ? 1 : schedCancel) - 1;
    if (idx < 0 || idx >= scheduled.length) {
      return { reply: `There ${scheduled.length === 1 ? 'is only 1 booked send' : `are only ${scheduled.length} booked sends`}:\n${scheduledLines(scheduled)}\n\nPick a number on that list.` };
    }
    const removed = scheduled[idx];
    const rest = scheduled.filter((_, i) => i !== idx);
    const next: Profile = { ...profile };
    if (rest.length) next.mailScheduled = rest;
    else delete next.mailScheduled;
    return {
      reply: `Unbooked — "${removed.subject || '(no subject)'}" to ${removed.to} won't send. The draft itself is still on the shelf.`,
      profile: next,
    };
  }

  // ── v33: "check my inbox" — a metadata read, nothing changes ──────────────
  if (inboxAsk) {
    const g = await gmailToken(email);
    if (g === null) return { reply: UNREACHABLE_INBOX };
    if (g === 'not-connected') return { reply: NOT_CONNECTED_READ };
    const msgs = await searchInbox(g, 'in:inbox', INBOX_PEEK);
    if (msgs === null) return { reply: UNREACHABLE_INBOX };
    if (!msgs.length) return { reply: 'Your inbox is clear — nothing waiting in there right now.' };
    const lines = msgs.map((m, i) =>
      `${i + 1}. ${fromName(m.from) || '(unknown sender)'} — "${m.subject || '(no subject)'}"`
    ).join('\n');
    return {
      reply: `The ${msgs.length === 1 ? 'newest mail' : `${msgs.length} newest mails`} in your inbox:\n${lines}\n\nSay "reply to the last email from …" and I'll draft the reply — I read your inbox, I never delete from it.`,
    };
  }

  // ── v33: "reply to the last email from X" — find it, draft the Re:, offer ─
  if (replyAsk) {
    const g = await gmailToken(email);
    if (g === null) return { reply: UNREACHABLE_INBOX };
    if (g === 'not-connected') return { reply: NOT_CONNECTED_READ };
    const msgs = await searchInbox(g, `in:inbox from:(${replyAsk.from})`, 1);
    if (msgs === null) return { reply: UNREACHABLE_INBOX };
    if (!msgs.length) {
      return { reply: `I looked, but there's no inbox email from "${replyAsk.from}". Say "check my inbox" and I'll show you who HAS written.` };
    }
    const src = msgs[0];
    const to = fromAddress(src.from);
    if (!to) {
      return { reply: `I found the email from ${fromName(src.from)}, but couldn't read a clean address to reply to. Open it in the Email tool and reply from there.` };
    }
    const drafts = await listDrafts(email);
    if (drafts === null) return { reply: UNREACHABLE };
    if (drafts.length >= MAX_DRAFTS) {
      return { reply: `The drafts shelf is full — ${MAX_DRAFTS} is my ceiling. Say "delete email draft N" (or clean up in the Email tool) and I'll write the reply.` };
    }
    const subject = (/^re:/i.test(src.subject.trim()) ? src.subject.trim() : `Re: ${src.subject.trim() || '(no subject)'}`).slice(0, MAX_SUBJECT);
    const body = replyAsk.body ?? defaultReplyBody(src, profile);
    const row = await insertDraft(email, to, subject, body);
    if (!row) return { reply: UNREACHABLE };
    const bodyNote = replyAsk.body
      ? ''
      : '\n\nI kept the body to a simple acknowledgement — add "saying …" to your ask to write it yourself, or polish it in the Email tool first.';
    const stamp: MailSend = { id: row.id, to, subject, asked: new Date().toISOString() };
    return {
      reply: `Drafted the reply to ${fromName(src.from)} (${to}). ${sendOffer(to, subject)}${bodyNote}`,
      profile: { ...profile, mailSend: stamp },
    };
  }

  return null;
}

// ── v33: booked sends fire at session start ─────────────────────────────────

/**
 * Fire every booked send whose moment has passed — called on the first
 * message of a fresh session (never on a crisis reply). Each due booking
 * RE-READS its draft (edited/deleted drafts are never mis-sent), goes through
 * the user's own Gmail, and reports honestly whichever way it lands. Bookings
 * that can't fire yet (unreachable, Gmail disconnected, send refused) stay
 * booked and say so. Returns null when nothing is due.
 */
export async function runDueSends(
  profile: Profile,
  email: string,
  now = Date.now(),
): Promise<{ note: string; profile: Profile } | null> {
  const scheduled = profile.mailScheduled ?? [];
  if (!email || !scheduled.length) return null;
  const due = scheduled.filter((s) => Date.parse(s.sendAt) <= now);
  if (!due.length) return null;

  const keep = scheduled.filter((s) => Date.parse(s.sendAt) > now);
  const lines: string[] = [];
  let token: GmailToken | 'not-connected' | null | undefined;

  for (const s of due) {
    const label = `"${s.subject || '(no subject)'}" to ${s.to}`;
    const draft = await getDraft(email, s.id);
    if (draft === null) {
      keep.push(s);
      lines.push(`• ${label} was due, but I couldn't reach the drafts shelf — it stays booked and I'll try again next session.`);
      continue;
    }
    if (draft === 'gone') {
      lines.push(`• ${label} was due, but the draft was sent or deleted in the meantime — nothing went out, and the booking is off.`);
      continue;
    }
    if (token === undefined) token = await gmailToken(email);
    if (token === null) {
      keep.push(s);
      lines.push(`• ${label} was due, but I couldn't reach Gmail — it stays booked and I'll try again next session.`);
      continue;
    }
    if (token === 'not-connected') {
      keep.push(s);
      lines.push(`• ${label} is due, but Gmail isn't connected — open Email in the Tools menu and tap Connect Gmail. It stays booked until then.`);
      continue;
    }
    const ok = await sendViaGmail(token, draft);
    if (!ok) {
      keep.push(s);
      lines.push(`• ${label} was due, but Gmail didn't accept the send — it stays booked and I'll try again next session.`);
      continue;
    }
    await markSent(email, draft.id);
    lines.push(`• Sent ${label} — it was booked for ${humanTime(s.sendAt)}.`);
  }

  const next: Profile = { ...profile };
  if (keep.length) next.mailScheduled = keep;
  else delete next.mailScheduled;
  const lead = due.length === 1 ? 'Your booked send:' : 'Your booked sends:';
  return { note: `${lead}\n${lines.join('\n')}`, profile: next };
}
