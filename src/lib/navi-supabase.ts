import { supabase } from './supabase';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string;

export interface NaviSession {
  email: string;
  access_token: string;
}

export interface SubscriptionStatus {
  active: boolean;
  tier: 'mini' | 'max' | null;
  expires_at: string | null;
  canAccessMini: boolean;
  canAccessMax: boolean;
}

export interface UsageStatus {
  spent_usd: number;
  limit_usd: number;
  month_key: string;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
  tier: string;
}

async function sbGet(path: string): Promise<unknown> {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: ANON_KEY, Authorization: `Bearer ${ANON_KEY}` },
  });
  if (!r.ok) return null;
  return r.json();
}

// Send a magic link to the given email address.
export async function sendMagicLink(email: string): Promise<{ error?: string }> {
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: 'https://navisociety.github.io' },
  });
  if (error) return { error: error.message };
  return {};
}

// No longer needed — Supabase client handles the hash via detectSessionInUrl.
// Kept so callers in App.tsx compile without changes.
export function extractSessionFromHash(): NaviSession | null {
  return null;
}

// No longer needed — Supabase client manages its own localStorage key.
export function getStoredSession(): NaviSession | null {
  return null;
}

export function storeSession(_session: NaviSession): void {}

export function clearSession(): void {
  supabase.auth.signOut();
}

export async function getSubscriptionStatus(email: string): Promise<SubscriptionStatus> {
  const inactive: SubscriptionStatus = {
    active: false, tier: null, expires_at: null, canAccessMini: false, canAccessMax: false,
  };
  const rows = await sbGet(
    `navi_subscriptions?email=eq.${encodeURIComponent(email)}&status=eq.active&order=created_at.desc&limit=1`
  );
  if (!Array.isArray(rows) || rows.length === 0) return inactive;
  const row = rows[0] as { tier: 'mini' | 'max'; expires_at: string | null };
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return inactive;
  const canAccessMax = row.tier === 'max';
  const canAccessMini = row.tier === 'mini' || row.tier === 'max';
  return { active: true, tier: row.tier, expires_at: row.expires_at, canAccessMini, canAccessMax };
}

export async function getUsageStatus(email: string, tier: 'mini' | 'max'): Promise<UsageStatus> {
  const monthKey = new Date().toISOString().slice(0, 7);
  const limitUsd = tier === 'mini' ? 5 : 10;
  const rows = await sbGet(
    `navi_usage?email=eq.${encodeURIComponent(email)}&month_key=eq.${monthKey}&tier=eq.${tier}&limit=1`
  );
  if (!Array.isArray(rows) || rows.length === 0) {
    return { spent_usd: 0, limit_usd: limitUsd, month_key: monthKey };
  }
  return {
    spent_usd: Number((rows[0] as { usd_spent: number }).usd_spent),
    limit_usd: limitUsd,
    month_key: monthKey,
  };
}

export async function saveMessage(
  email: string, role: 'user' | 'assistant', content: string, tier = 'free'
): Promise<void> {
  try {
    await fetch(`${SUPABASE_URL}/functions/v1/navi-chats`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, role, content, tier }),
    });
  } catch {}
}

export async function loadChatHistory(email: string): Promise<ChatMessage[]> {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/navi-chats?email=${encodeURIComponent(email)}`);
    if (!r.ok) return [];
    const data = await r.json();
    if (Array.isArray(data)) return data as ChatMessage[];
    return (data?.messages ?? []) as ChatMessage[];
  } catch {
    return [];
  }
}

export async function callNaviPro(
  endpoint: 'navi-mini' | 'navi-max',
  message: string,
  history: Array<{ role: string; content: string }>,
  email: string
): Promise<{ response?: string; error?: string; code?: string; usage?: UsageStatus }> {
  try {
    const r = await fetch(`${SUPABASE_URL}/functions/v1/${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history, user_email: email }),
    });
    return r.json();
  } catch {
    return { error: 'Network error' };
  }
}
