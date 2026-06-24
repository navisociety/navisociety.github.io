const SUPABASE_URL = 'https://nmxwsjvmhoxjvkhgqmic.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishableJgxoyoCO1-5v2K203_06Q_EXUeihOb';

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

async function sbGet(path: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${SUPABASE_ANON_KEY}` },
  });
  if (!r.ok) return null;
  return r.json();
}

// Parse magic link token from URL hash after Supabase redirects back
export function extractSessionFromHash(): NaviSession | null {
  try {
    const hash = window.location.hash;
    if (!hash.includes('access_token=')) return null;
    const params = new URLSearchParams(hash.slice(1));
    const token = params.get('access_token');
    if (!token) return null;
    const payload = JSON.parse(atob(token.split('.')[1]));
    const email = payload.email as string | undefined;
    if (!email) return null;
    window.history.replaceState(null, '', window.location.pathname);
    return { email, access_token: token };
  } catch {
    return null;
  }
}

export async function sendMagicLink(email: string): Promise<{ error?: string }> {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
    method: 'POST',
    headers: { 'apikey': SUPABASE_ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, create_user: true }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    return { error: (err as { msg?: string }).msg ?? 'Failed to send link' };
  }
  return {};
}

export function getStoredSession(): NaviSession | null {
  try {
    const raw = localStorage.getItem('navi_session');
    if (!raw) return null;
    return JSON.parse(raw) as NaviSession;
  } catch {
    return null;
  }
}

export function storeSession(session: NaviSession) {
  localStorage.setItem('navi_session', JSON.stringify(session));
}

export function clearSession() {
  localStorage.removeItem('navi_session');
}

export async function getSubscriptionStatus(email: string): Promise<SubscriptionStatus> {
  const inactive: SubscriptionStatus = { active: false, tier: null, expires_at: null, canAccessMini: false, canAccessMax: false };
  const rows = await sbGet(`navi_subscriptions?email=eq.${encodeURIComponent(email)}&status=eq.active&order=created_at.desc&limit=1`);
  if (!Array.isArray(rows) || rows.length === 0) return inactive;
  const row = rows[0] as { tier: 'mini' | 'max'; expires_at: string | null };

  // Expired subscriptions fall back to free, even if the row is still marked active.
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return inactive;

  // Tier access hierarchy:
  //   max  -> can access both Mini and Max modes
  //   mini -> can access Mini only (Max is gated behind an upgrade)
  const canAccessMax = row.tier === 'max';
  const canAccessMini = row.tier === 'mini' || row.tier === 'max';

  return { active: true, tier: row.tier, expires_at: row.expires_at, canAccessMini, canAccessMax };
}

export async function getUsageStatus(email: string, tier: 'mini' | 'max'): Promise<UsageStatus> {
  const monthKey = new Date().toISOString().slice(0, 7);
  const limitUsd = tier === 'mini' ? 5 : 10;
  const rows = await sbGet(`navi_usage?email=eq.${encodeURIComponent(email)}&month_key=eq.${monthKey}&tier=eq.${tier}&limit=1`);
  if (!Array.isArray(rows) || rows.length === 0) return { spent_usd: 0, limit_usd: limitUsd, month_key: monthKey };
  return { spent_usd: Number((rows[0] as { usd_spent: number }).usd_spent), limit_usd: limitUsd, month_key: monthKey };
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
    return (data.messages ?? []) as ChatMessage[];
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
