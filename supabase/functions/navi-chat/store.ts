// supabase/functions/navi-chat/store.ts
//
// NAVI permanent memory persistence (v18). One durable memory row per user in
// the navi_memory table, keyed by email. loadStoredProfile() reads it at the
// start of a request; saveStoredProfile() upserts it at the end. This is what
// turns NAVI's in-conversation memory (memory.ts) into memory that survives
// across chats, sessions, and devices — when a signed-in user says "remember
// that…", it's here on their next visit and inside every other chat.
//
// Server-side only, exactly like bible.ts: uses the service-role key that the
// Supabase runtime injects, and the browser never touches this table (RLS is
// on with no policies). Every call is best-effort — a DB hiccup must never take
// the chat down, so failures fall back to an empty/unchanged memory.

import type { Profile } from './memory.ts';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

const authHeaders = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
};

/** Load a user's saved profile. Returns {} when there's nothing (or on error). */
export async function loadStoredProfile(email: string): Promise<Profile> {
  if (!email || !SUPABASE_URL || !SERVICE_KEY) return {};
  try {
    const url = `${SUPABASE_URL}/rest/v1/navi_memory` +
      `?email=eq.${encodeURIComponent(email)}` +
      `&select=profile,last_seen,last_mood&limit=1`;
    const res = await fetch(url, { headers: authHeaders, signal: AbortSignal.timeout(4000) });
    if (!res.ok) return {};
    const rows = await res.json();
    if (!Array.isArray(rows) || rows.length === 0) return {};
    const row = rows[0];
    const profile: Profile =
      row.profile && typeof row.profile === 'object' && !Array.isArray(row.profile)
        ? row.profile
        : {};
    // last_seen / last_mood live in their own columns; fold them back into the
    // profile object so the rest of the code sees one unified shape.
    if (typeof row.last_seen === 'string') profile.lastSeen = row.last_seen;
    if (typeof row.last_mood === 'string') profile.lastMood = row.last_mood;
    return profile;
  } catch {
    return {};
  }
}

/** Upsert a user's profile. last_seen is refreshed to now on every save. */
export async function saveStoredProfile(email: string, profile: Profile): Promise<void> {
  if (!email || !SUPABASE_URL || !SERVICE_KEY) return;
  // Keep last_seen / last_mood out of the jsonb — they have their own columns.
  const { lastSeen: _ls, lastMood, ...rest } = profile;
  const nowISO = new Date().toISOString();
  const body = [{
    email,
    profile: rest,
    last_seen: profile.lastSeen ?? nowISO,
    last_mood: lastMood ?? null,
    updated_at: nowISO,
  }];
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/navi_memory?on_conflict=email`, {
      method: 'POST',
      headers: {
        ...authHeaders,
        'Content-Type': 'application/json',
        Prefer: 'resolution=merge-duplicates,return=minimal',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(4000),
    });
  } catch {
    // Best-effort: a failed save just means this fact isn't persisted this turn.
  }
}
