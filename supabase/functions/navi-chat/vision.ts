// supabase/functions/navi-chat/vision.ts
//
// NAVI v30 — The Vision Board bridge: cross-platform execution.
//
// NAVI stops being confined to the chat screen. "add finish my album to my
// vision board" pins a goal tile onto the same navi_vision_items table the
// Vision Board tool renders — say it in chat (or put it in a workflow step)
// and it's on the board the next time the tool opens. "what's on my vision
// board" reads the board back; "remove … from my vision board" takes a text
// goal off it. "put my mission on my vision board" pins the active mission's
// goal, so the thing being executed is also the thing being seen.
//
// Server-side only, exactly like store.ts/bible.ts: direct PostgREST calls
// with the service-role key the runtime injects (edge-runtime RPCs don't
// persist — direct table writes are the proven path). Every call is
// best-effort, but a vision command that reaches the DB layer and fails gets
// an HONEST "couldn't reach the board" reply — never a silent shrug, because
// the command itself was understood.
//
// Safety rails, same law as the rest of the agentic layer:
//   - anchored, conservative parsing on the tidied message; null means
//     "not my business" and the pipeline runs on.
//   - crisis language is never a goal to pin (CRISIS_RX).
//   - signed-in only — the board is keyed by email.
//   - chat only removes TEXT goals. Photos carry storage files that the
//     Vision Board tool cleans up properly, so they're managed there.
//   - the tool's own caps are respected (60 items, 280/60-char columns).

import type { Profile } from './memory.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const authHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
};

const MAX_ITEMS = 60; // the navi-vision function's own cap

// Same guard as agent.ts/habit.ts: crisis language is a human emergency,
// never a goal to pin on a board.
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

const ADD_RX =
  /^(?:please )?(?:add|put|pin) (?:["'“]?(.{2,120}?)["'”]?) (?:to|on|onto) my vision board$/;
const ADD_COLON_RX =
  /^(?:please )?(?:add|pin) to my vision board ?[:—-] ?(.{2,120})$/;

const LIST_RX =
  /^(?:what'?s on|what is on|show(?: me)?|list|read(?: me)?|check) my vision board$/;

const REMOVE_RX =
  /^(?:please )?(?:remove|delete|take) (?:["'“]?(.{2,120}?)["'”]?) (?:from|off)(?: of)? my vision board$/;

/** The goal text from an "add X to my vision board" ask, or null. Crisis-guarded. */
export function parseVisionAdd(message: string): string | null {
  const t = tidy(message);
  if (!t || t.length > 160) return null;
  const m = t.match(ADD_RX) ?? t.match(ADD_COLON_RX);
  if (!m) return null;
  const text = m[1].trim();
  if (!text || CRISIS_RX.test(text)) return null;
  return text;
}

/** The item name from a "remove X from my vision board" ask, or null. */
export function parseVisionRemove(message: string): string | null {
  const t = tidy(message);
  if (!t || t.length > 160) return null;
  const m = t.match(REMOVE_RX);
  return m ? m[1].trim() : null;
}

/** True for a "what's on my vision board" read ask. */
export function isVisionListAsk(message: string): boolean {
  const t = tidy(message);
  return !!t && LIST_RX.test(t);
}

// ── The board, over PostgREST ───────────────────────────────────────────────

type VisionItem = { id: number | string; kind: string; name: string; content: string };

/** All of a user's items, oldest position first — or null when unreachable. */
async function listItems(email: string): Promise<VisionItem[] | null> {
  if (!SUPABASE_URL || !SERVICE_KEY) return null;
  try {
    const url = `${SUPABASE_URL}/rest/v1/navi_vision_items` +
      `?user_email=eq.${encodeURIComponent(email)}` +
      `&select=id,kind,name,content,position&order=position.asc,created_at.asc`;
    const res = await fetch(url, { headers: authHeaders, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return null;
    const rows = await res.json();
    return Array.isArray(rows) ? rows : null;
  } catch {
    return null;
  }
}

/** Pin a text goal onto the board. True on success. */
async function addText(email: string, text: string, position: number): Promise<boolean> {
  if (!SUPABASE_URL || !SERVICE_KEY) return false;
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/navi_vision_items`, {
      method: 'POST',
      headers: { ...authHeaders, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify([{
        user_email: email,
        kind: 'text',
        content: text.slice(0, 280),
        name: text.slice(0, 60),
        notes: 'Pinned by NAVI from chat',
        shape: 'square',
        position,
      }]),
      signal: AbortSignal.timeout(4000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Delete one item by id (scoped to the user). True on success. */
async function deleteItem(email: string, id: number | string): Promise<boolean> {
  if (!SUPABASE_URL || !SERVICE_KEY) return false;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/navi_vision_items?id=eq.${encodeURIComponent(String(id))}` +
        `&user_email=eq.${encodeURIComponent(email)}`,
      { method: 'DELETE', headers: authHeaders, signal: AbortSignal.timeout(4000) },
    );
    return res.ok;
  } catch {
    return false;
  }
}

// ── Replies ─────────────────────────────────────────────────────────────────

const UNREACHABLE =
  "I couldn't reach your vision board just now — the command was clear, the connection wasn't. Try me again in a moment.";

const SIGN_IN_REPLY =
  'Your vision board lives in your account, so I can only touch it once you\'re signed in. Sign in and tell me again — then "add … to my vision board" works from anywhere, even inside a workflow.';

function itemLabel(it: VisionItem): string {
  const label = (it.name || it.content || '').trim() || '(untitled)';
  return it.kind === 'image' ? `${label} (photo)` : label;
}

// ── Entry point ─────────────────────────────────────────────────────────────

/**
 * Handle a vision-board command, or return null when the message isn't board
 * business. Same contract as tryReminder — but the board lives in its OWN
 * table, so no profile ever comes back; the reply is the whole result.
 * Works as a workflow step: answerIntent calls this, so "add * to my vision
 * board" inside a saved routine pins the topic of the day.
 */
export async function tryVision(
  message: string,
  email: string,
  profile: Profile,
): Promise<{ reply: string } | null> {
  const listAsk = isVisionListAsk(message);
  let toAdd = parseVisionAdd(message);
  const toRemove = listAsk ? null : parseVisionRemove(message);
  if (!listAsk && !toAdd && !toRemove) return null;

  if (!email) return { reply: SIGN_IN_REPLY };

  // "put my mission on my vision board" — the active mission's goal is the tile.
  if (toAdd && /^(?:my |the )?(?:active |current )?mission(?: goal)?$/.test(toAdd)) {
    if (!profile.mission) {
      return { reply: 'There\'s no active mission to pin. Start one ("start a mission to…") or name the goal directly: "add … to my vision board".' };
    }
    toAdd = profile.mission.goal;
  }

  const items = await listItems(email);
  if (items === null) return { reply: UNREACHABLE };

  if (listAsk) {
    if (!items.length) {
      return { reply: 'Your vision board is empty. Say "add … to my vision board" and I\'ll pin the first goal — it\'ll be there when you open the Vision Board tool.' };
    }
    const lines = items.map((it, i) => `${i + 1}. ${itemLabel(it)}`).join('\n');
    return { reply: `Your vision board holds ${items.length} item${items.length === 1 ? '' : 's'}:\n${lines}\n\nSay "add … to my vision board" to pin another, or open the Vision Board tool to arrange them.` };
  }

  if (toAdd) {
    if (items.length >= MAX_ITEMS) {
      return { reply: `The board is full — ${MAX_ITEMS} items is its limit. Say "remove … from my vision board" (or clear space in the Vision Board tool) and I'll pin it.` };
    }
    const dup = items.find((it) => (it.name || '').toLowerCase() === toAdd!.toLowerCase());
    if (dup) {
      return { reply: `"${toAdd}" is already on your vision board — one tile is enough; the looking-at-it-daily part is yours.` };
    }
    const maxPos = items.reduce((mx, it) => Math.max(mx, Number((it as VisionItem & { position?: number }).position ?? -1)), -1);
    const ok = await addText(email, toAdd, maxPos + 1);
    if (!ok) return { reply: UNREACHABLE };
    return { reply: `Pinned to your vision board: "${toAdd}" — item ${items.length + 1}. It's on the board the next time you open the Vision Board tool. Goals you can SEE are goals you chase.` };
  }

  if (toRemove) {
    const needle = toRemove.toLowerCase();
    const match = items.find((it) => {
      const name = (it.name || it.content || '').toLowerCase();
      return name === needle || name.includes(needle) || needle.includes(name);
    });
    if (!match) {
      return { reply: items.length
        ? `Nothing on the board matches "${toRemove}". It holds:\n${items.map((it, i) => `${i + 1}. ${itemLabel(it)}`).join('\n')}`
        : 'Your vision board is already empty — nothing to remove.' };
    }
    if (match.kind === 'image') {
      return { reply: `"${itemLabel(match)}" is a photo, and photos are yours to manage in the Vision Board tool — I only take text goals off the board from chat, so nothing precious disappears on a phrase.` };
    }
    const ok = await deleteItem(email, match.id);
    if (!ok) return { reply: UNREACHABLE };
    return { reply: `Removed "${itemLabel(match)}" from your vision board. ${items.length - 1 ? `${items.length - 1} item${items.length - 1 === 1 ? '' : 's'} still up there.` : 'The board is clear — ready for the next season\'s goals.'}` };
  }

  return null;
}
