// supabase/functions/navi-chat/mail.ts
//
// NAVI v32 — The email bridge: NAVI executes REAL tasks.
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

import type { MailSend, Profile } from './memory.ts';

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
  const sendN = draftAsk || listAsk || deleteN !== null ? null : parseDraftSend(message);

  // Bare yes/no with nothing pending is ordinary conversation — not ours.
  if (!pending && (confirmBare || cancelBare) && !confirmExplicit && !cancelExplicit) {
    return null;
  }
  if (!draftAsk && !listAsk && deleteN === null && sendN === null &&
      !confirmExplicit && !cancelExplicit && !(pending && (confirmBare || cancelBare))) {
    return null;
  }

  if (!email) return { reply: SIGN_IN_REPLY };

  // ── Confirm / cancel a pending send ───────────────────────────────────────
  if (pending && (confirmBare || confirmExplicit || cancelBare || cancelExplicit) &&
      !draftAsk && listAsk === false && deleteN === null && sendN === null) {
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
  if (!pending && (confirmExplicit || cancelExplicit) &&
      !draftAsk && !listAsk && deleteN === null && sendN === null) {
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

  return null;
}
