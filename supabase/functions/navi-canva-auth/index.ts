// navi-canva-auth: per-user Canva OAuth for the NAVI Create tool
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const ALLOWED = [
  'https://navisociety.github.io',
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:5173',
];

function cors(origin: string | null) {
  const o = origin && ALLOWED.includes(origin) ? origin : ALLOWED[0];
  return {
    'Access-Control-Allow-Origin': o,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const CLIENT_ID = Deno.env.get('CANVA_CLIENT_ID') ?? '';
const CLIENT_SECRET = Deno.env.get('CANVA_CLIENT_SECRET') ?? '';
const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const REDIRECT_URI = `${SUPABASE_URL}/functions/v1/navi-canva-auth?action=callback`;
const APP_URL = 'https://navisociety.github.io';
const SCOPE = 'design:content:read design:content:write design:meta:read';

const TOKEN_URL = 'https://api.canva.com/rest/v1/oauth/token';
const AUTH_URL = 'https://www.canva.com/api/oauth/authorize';

function b64urlEncode(s: string): string {
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s: string): string {
  const base64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(atob(base64).split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
}

async function exchangeCode(code: string): Promise<{ access_token: string; refresh_token?: string; expires_in: number }> {
  const basic = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
    body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI }),
  });
  if (!r.ok) throw new Error(`Canva token exchange failed: ${r.status} ${await r.text()}`);
  return r.json();
}

async function refreshUserToken(email: string): Promise<string> {
  const { data } = await sb.from('navi_canva_tokens').select('refresh_token').eq('user_email', email).single();
  if (!data?.refresh_token) throw new Error('No refresh token');
  const basic = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: data.refresh_token }),
  });
  if (!r.ok) throw new Error(`Canva token refresh failed: ${r.status} ${await r.text()}`);
  const d = await r.json();
  const expiresAt = new Date(Date.now() + (d.expires_in ?? 0) * 1000).toISOString();
  await sb.from('navi_canva_tokens').update({
    access_token: d.access_token,
    refresh_token: d.refresh_token ?? data.refresh_token,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  }).eq('user_email', email);
  return d.access_token as string;
}

serve(async (req) => {
  const origin = req.headers.get('Origin');
  const c = cors(origin);
  if (req.method === 'OPTIONS') return new Response(null, { headers: c });

  const url = new URL(req.url);
  const queryAction = url.searchParams.get('action');

  // --- OAuth callback (GET redirect from Canva) ---
  if (req.method === 'GET' && queryAction === 'callback') {
    try {
      const code = url.searchParams.get('code') ?? '';
      const state = url.searchParams.get('state') ?? '';
      if (!code || !state) throw new Error('Missing code or state');
      const decoded = JSON.parse(b64urlDecode(state));
      const email = decoded.email as string;
      if (!email) throw new Error('Missing email in state');

      const tokens = await exchangeCode(code);
      const expiresAt = new Date(Date.now() + (tokens.expires_in ?? 0) * 1000).toISOString();
      await sb.from('navi_canva_tokens').upsert({
        user_email: email,
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token ?? null,
        expires_at: expiresAt,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_email' });

      return new Response(null, { status: 302, headers: { Location: `${APP_URL}/?canva_connected=true` } });
    } catch (e) {
      return new Response(null, { status: 302, headers: { Location: `${APP_URL}/?canva_error=${encodeURIComponent(String(e))}` } });
    }
  }

  try {
    const body = req.method === 'POST' ? await req.json() : {};
    const action = body.action ?? queryAction;
    const email = body.email;

    if (action === 'start-oauth') {
      if (!email) return Response.json({ error: 'email required' }, { status: 400, headers: c });
      if (!CLIENT_ID) return Response.json({ connected: false, setupPending: true }, { headers: c });
      const state = b64urlEncode(JSON.stringify({ email, ts: Date.now() }));
      const p = new URLSearchParams({
        response_type: 'code',
        client_id: CLIENT_ID,
        redirect_uri: REDIRECT_URI,
        scope: SCOPE,
        state,
      });
      return Response.json({ url: `${AUTH_URL}?${p.toString()}` }, { headers: c });
    }

    if (action === 'get-status') {
      if (!email) return Response.json({ error: 'email required' }, { status: 400, headers: c });
      const { data } = await sb.from('navi_canva_tokens').select('user_email').eq('user_email', email).single();
      return Response.json({ connected: !!data, setupPending: !CLIENT_ID }, { headers: c });
    }

    if (action === 'disconnect') {
      if (!email) return Response.json({ error: 'email required' }, { status: 400, headers: c });
      await sb.from('navi_canva_tokens').delete().eq('user_email', email);
      return Response.json({ ok: true }, { headers: c });
    }

    if (action === 'refresh-token') {
      if (!email) return Response.json({ error: 'email required' }, { status: 400, headers: c });
      const access = await refreshUserToken(email);
      return Response.json({ access_token: access }, { headers: c });
    }

    return Response.json({ error: 'unknown action' }, { status: 400, headers: c });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500, headers: cors(req.headers.get('Origin')) });
  }
});
