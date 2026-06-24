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
}

export interface UsageStatus {
  spent_usd: number;
  limit_usd: number;
  month_key: string;
}

async function sbGet(path: string, token?: string) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${token ?? SUPABASE_ANON_KEY}`,
    },
  });
  if (!r.ok) return null;
  return r.json();
}

export async function sendMagicLink(email: string): Promise<{ error?: string }> {
  const r = await fetch(`${SUPABASE_URL}/auth/v1/otp`, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email, create_user: true }),
  });
  if (!r.ok) {
    const err = await r.json().catch(() => ({}));
    return { error: (err as {msg?: string}).msg ?? 'Failed to send link' };
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
  const rows = await sbGet(`navi_subscriptions?email=eq.${encodeURIComponent(email)}&status=eq.active&order=created_at.desc&limit=1`);
  if (!Array.isArray(rows) || rows.length === 0) return { active: false, tier: null, expires_at: null };
  const row = rows[0] as {tier: 'mini' | 'max'; expires_at: string};
  return { active: true, tier: row.tier, expires_at: row.expires_at };
}

export async function getUsageStatus(email: string, tier: 'mini' | 'max'): Promise<UsageStatus> {
  const monthKey = new Date().toISOString().slice(0, 7);
  const limitUsd = tier === 'mini' ? 5 : 10;
  const rows = await sbGet(`navi_usage?email=eq.${encodeURIComponent(email)}&month_key=eq.${monthKey}&tier=eq.${tier}&limit=1`);
  if (!Array.isArray(rows) || rows.length === 0) return { spent_usd: 0, limit_usd: limitUsd, month_key: monthKey };
  return { spent_usd: Number((rows[0] as {usd_spent: number}).usd_spent), limit_usd: limitUsd, month_key: monthKey };
}

export async function loadConversationHistory(email: string, limit = 20): Promise<Array<{role: string; content: string}>> {
  const rows = await sbGet(`navi_conversations?email=eq.${encodeURIComponent(email)}&order=created_at.desc&limit=${limit}`);
  if (!Array.isArray(rows)) return [];
  return (rows as Array<{role: string; content: string}>).reverse();
}

export async function callNaviPro(
  endpoint: 'navi-mini' | 'navi-max',
  message: string,
  history: Array<{role: string; content: string}>,
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
