// supabase/functions/navi-chat/chats.ts
//
// NAVI v31 — The chat-sessions bridge: NAVI stewards its own history.
//
// The second cross-platform bridge, following vision.ts's proven pattern:
// direct PostgREST calls on the tool's own table (navi_chat_sessions — the
// same table the Chats screen renders), honest "couldn't reach" replies, and
// null for anything that isn't chat business.
//
//   "how many chats do i have" / "list my chats"  → count + the 5 most recent
//   "clean up my old chats"                        → counts chats idle 30+ days
//   "delete chats older than 60 days"              → …or any horizon ≥ 7 days
//
// Deleting is DESTRUCTIVE (the session's messages CASCADE away with it), so
// cleanup is a TWO-STEP move: NAVI first counts and names what would go, then
// waits for an explicit confirmation. The pending offer is stamped on the
// profile (Profile.chatCleanup) so it survives the round-trip; a bare "yes"
// only counts while the offer is fresh (10 minutes), an explicit "yes, clean
// up my chats" works as long as the stamp exists, and the count is re-taken
// at execute time so the reply never overstates what happened.
//
// Safety rails:
//   - the horizon has a 7-day FLOOR — the active chat's updated_at is always
//     recent, so today's conversation can never delete itself.
//   - anchored, conservative parsing; bare "yes"/"no" mean nothing unless a
//     cleanup offer is actually pending.
//   - signed-in only — the history is keyed by email.

import type { ChatCleanup, Profile } from './memory.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const authHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
};

const MIN_DAYS = 7; // the floor — never reachable by the chat you're typing in
const DEFAULT_DAYS = 30;
const CONFIRM_WINDOW_MS = 10 * 60 * 1000; // a bare "yes" must be this fresh

function tidy(message: string): string {
  return message
    .toLowerCase()
    .replace(/^\s*(?:hey|hi|hello|yo)?[,\s]*navi[,:\s]+/, '')
    .replace(/[.!?]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── Command parsing ─────────────────────────────────────────────────────────

const COUNT_RX =
  /^(?:how many (?:chats|conversations) (?:do i have|have we had|are there)|(?:list|show)(?: me)?(?: all)?(?: my| our)? (?:chats|chat history|conversations)|what (?:chats|conversations) do i have)$/;

const CLEANUP_OLD_RX =
  /^(?:please )?(?:clean ?up|clear out|tidy(?: up)?|delete|remove|prune)(?: my| the| our)? old (?:chats|conversations)$/;

const CLEANUP_THAN_RX =
  /^(?:please )?(?:clean ?up|clear out|delete|remove|prune)(?: my| the| our)?(?: old)? (?:chats|conversations) (?:older|idle) than (\d{1,3}) (days?|weeks?|months?)$/;

// Confirmations. The bare forms (yes / do it) are ONLY read while an offer is
// fresh; the chat-explicit forms work as long as the offer stamp exists.
const CONFIRM_BARE_RX = /^(?:yes|yes please|yep|yeah|do it|go ahead|confirm)$/;
const CONFIRM_EXPLICIT_RX =
  /^(?:yes,? )?(?:clean|clear|delete|remove) them(?: up| all)?$|^yes,? clean up my (?:old )?chats$|^confirm (?:the )?chat clean ?up$/;

const CANCEL_BARE_RX = /^(?:no|nope|don'?t|never ?mind|leave them|keep them)$/;
const CANCEL_EXPLICIT_RX = /^cancel (?:the )?chat clean ?up$/;

/** The cleanup horizon in days from a cleanup ask, or null when it isn't one. */
export function parseCleanupAsk(message: string): number | null {
  const t = tidy(message);
  if (!t || t.length > 120) return null;
  if (CLEANUP_OLD_RX.test(t)) return DEFAULT_DAYS;
  const m = t.match(CLEANUP_THAN_RX);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  const unit = m[2].startsWith('week') ? 7 : m[2].startsWith('month') ? 30 : 1;
  return n * unit;
}

/** True for a "how many chats do i have" / "list my chats" read ask. */
export function isChatCountAsk(message: string): boolean {
  const t = tidy(message);
  return !!t && COUNT_RX.test(t);
}

// ── The sessions table, over PostgREST ──────────────────────────────────────

type ChatSession = { id: string; title: string; updated_at: string };

/** All of a user's sessions, most recent first — or null when unreachable. */
async function listSessions(email: string): Promise<ChatSession[] | null> {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  try {
    const url = `${SUPABASE_URL}/rest/v1/navi_chat_sessions` +
      `?email=eq.${encodeURIComponent(email)}` +
      `&select=id,title,updated_at&order=updated_at.desc&limit=1000`;
    const res = await fetch(url, { headers: authHeaders, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

/**
 * Delete every session idle since before the cutoff. Returns how many went
 * (the messages inside CASCADE away with them), or null when unreachable.
 */
async function deleteOlderThan(email: string, cutoffISO: string): Promise<number | null> {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  try {
    const url = `${SUPABASE_URL}/rest/v1/navi_chat_sessions` +
      `?email=eq.${encodeURIComponent(email)}` +
      `&updated_at=lt.${encodeURIComponent(cutoffISO)}&select=id`;
    const res = await fetch(url, {
      method: 'DELETE',
      headers: { ...authHeaders, Prefer: 'return=representation' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) ? rows.length : null;
  } catch {
    return null;
  }
}

// ── Replies ─────────────────────────────────────────────────────────────────

const UNREACHABLE =
  "I couldn't reach your chat history just now — the command was clear, the connection wasn't. Try me again in a moment.";

const SIGN_IN_REPLY =
  'Your chat history lives in your account, so I can only manage it once you\'re signed in. Sign in and tell me again — then "how many chats do i have" and "clean up my old chats" both work.';

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 10);
}

function offerLine(count: number, days: number): string {
  return `You have ${count} chat${count === 1 ? '' : 's'} that ${count === 1 ? 'hasn\'t' : 'haven\'t'} moved in over ${days} days. Deleting ${count === 1 ? 'it wipes its messages' : 'them wipes their messages'} for good — nothing comes back.\n\nSay "yes, clean them up" and I'll do it, or "no" to keep everything.`;
}

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Handle a chat-history command, or return null when the message isn't chat
 * business. Same contract as tryVision, plus a profile when the pending
 * cleanup stamp changes (the caller saves it). Bare "yes"/"no" return null
 * unless a cleanup offer is actually pending — ordinary conversation is
 * never captured.
 */
export async function tryChats(
  message: string,
  email: string,
  profile: Profile,
): Promise<{ reply: string; profile?: Profile } | null> {
  const t = tidy(message);
  if (!t) return null;

  const pending = profile.chatCleanup;
  const confirmBare = CONFIRM_BARE_RX.test(t);
  const confirmExplicit = CONFIRM_EXPLICIT_RX.test(t);
  const cancelBare = CANCEL_BARE_RX.test(t);
  const cancelExplicit = CANCEL_EXPLICIT_RX.test(t);
  const countAsk = isChatCountAsk(message);
  const cleanupDays = countAsk ? null : parseCleanupAsk(message);

  // Bare yes/no with nothing pending is ordinary conversation — not ours.
  if (!pending && (confirmBare || cancelBare) && !confirmExplicit && !cancelExplicit) {
    return null;
  }
  if (!countAsk && cleanupDays === null && !confirmExplicit && !cancelExplicit &&
      !(pending && (confirmBare || cancelBare))) {
    return null;
  }

  if (!email) return { reply: SIGN_IN_REPLY };

  // ── Confirm / cancel a pending cleanup ────────────────────────────────────
  if (pending && (confirmBare || confirmExplicit || cancelBare || cancelExplicit)) {
    const cleared: Profile = { ...profile };
    delete cleared.chatCleanup;
    if (cancelBare || cancelExplicit) {
      return { reply: 'Kept — nothing was deleted. Your chats stay exactly as they are.', profile: cleared };
    }
    const fresh = Date.now() - Date.parse(pending.asked) <= CONFIRM_WINDOW_MS;
    if (confirmBare && !confirmExplicit && !fresh) {
      return {
        reply: 'That cleanup offer went stale, so I won\'t delete on a bare "yes" this long after asking. Say "clean up my old chats" again and I\'ll re-count first.',
        profile: cleared,
      };
    }
    const deleted = await deleteOlderThan(email, pending.cutoff);
    if (deleted === null) return { reply: UNREACHABLE }; // stamp stays — try again
    return {
      reply: deleted === 0
        ? 'Nothing left to delete — those chats are already gone.'
        : `Done — ${deleted} old chat${deleted === 1 ? '' : 's'} deleted, messages and all. What's left is what still matters.`,
      profile: cleared,
    };
  }
  // A chat-explicit confirm/cancel with nothing pending gets pointed the right way.
  if (!pending && (confirmExplicit || cancelExplicit)) {
    return { reply: 'There\'s no chat cleanup waiting on a yes. Say "clean up my old chats" and I\'ll count what qualifies before deleting anything.' };
  }

  // ── "how many chats do i have" / "list my chats" ──────────────────────────
  if (countAsk) {
    const sessions = await listSessions(email);
    if (sessions === null) return { reply: UNREACHABLE };
    if (!sessions.length) {
      return { reply: 'No saved chats yet besides this conversation — your history starts here.' };
    }
    const top = sessions.slice(0, 5)
      .map((s, i) => `${i + 1}. ${s.title || 'Untitled'} — last active ${fmtDate(s.updated_at)}`)
      .join('\n');
    const more = sessions.length > 5 ? `\n…and ${sessions.length - 5} more.` : '';
    return {
      reply: `You have ${sessions.length} saved chat${sessions.length === 1 ? '' : 's'}. The most recent:\n${top}${more}\n\nSay "clean up my old chats" and I'll count what's been idle 30+ days — I always ask before deleting.`,
    };
  }

  // ── "clean up my old chats" — count, then ask ─────────────────────────────
  if (cleanupDays !== null) {
    const days = Math.max(cleanupDays, MIN_DAYS);
    const floorNote = cleanupDays < MIN_DAYS
      ? `${cleanupDays} day${cleanupDays === 1 ? '' : 's'} is too close to today — I keep a ${MIN_DAYS}-day floor so a live conversation can never delete itself. Counting at ${MIN_DAYS} days instead.\n\n`
      : '';
    const cutoff = new Date(Date.now() - days * 86400000).toISOString();
    const sessions = await listSessions(email);
    if (sessions === null) return { reply: UNREACHABLE };
    // Parse both sides — PostgREST timestamps come back +00:00-suffixed, the
    // cutoff is Z-suffixed, and a string compare would mishandle the boundary.
    const cutoffMs = Date.parse(cutoff);
    const old = sessions.filter((s) => Date.parse(s.updated_at) < cutoffMs);
    if (!old.length) {
      const cleared: Profile = { ...profile };
      delete cleared.chatCleanup;
      return {
        reply: `${floorNote}Nothing to clean — none of your ${sessions.length} chat${sessions.length === 1 ? '' : 's'} ${sessions.length === 1 ? 'has' : 'have'} sat idle for over ${days} days.`,
        profile: profile.chatCleanup ? cleared : undefined,
      };
    }
    const stamp: ChatCleanup = { cutoff, count: old.length, asked: new Date().toISOString() };
    return {
      reply: floorNote + offerLine(old.length, days),
      profile: { ...profile, chatCleanup: stamp },
    };
  }

  return null;
}
