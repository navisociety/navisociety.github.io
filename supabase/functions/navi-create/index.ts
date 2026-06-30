// navi-create: NAVI Create tool edge function (per-user Canva integration)
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
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

const sb = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
);

const CLIENT_ID = Deno.env.get('CANVA_CLIENT_ID') ?? '';
const CLIENT_SECRET = Deno.env.get('CANVA_CLIENT_SECRET') ?? '';
const TOKEN_URL = 'https://api.canva.com/rest/v1/oauth/token';
const DESIGNS_URL = 'https://api.canva.com/rest/v1/designs';

const COLS = 'id,user_email,title,prompt,status,canva_design_id,canva_edit_url,canva_export_url,created_at,updated_at';

const MSG_READY = 'Your design is ready in Canva! Tap the button below to open and export it.';
const MSG_NEEDS_AUTH = 'Connect your Canva account first to generate designs.';
const MSG_SETUP_PENDING = 'Canva integration is being set up. Your prompt is saved and will be sent to Canva once connected.';
const MSG_FAILED = 'I ran into an issue generating your design. Please try again.';

function deriveTitle(prompt: string): string {
  const words = (prompt ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 6).join(' ');
  return words.length > 0 ? words : 'New Creation';
}

async function refreshUserToken(email: string, refreshToken: string): Promise<string> {
  const basic = btoa(`${CLIENT_ID}:${CLIENT_SECRET}`);
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${basic}` },
    body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
  });
  if (!r.ok) throw new Error(`refresh failed: ${r.status}`);
  const d = await r.json();
  const expiresAt = new Date(Date.now() + (d.expires_in ?? 0) * 1000).toISOString();
  await sb.from('navi_canva_tokens').update({
    access_token: d.access_token,
    refresh_token: d.refresh_token ?? refreshToken,
    expires_at: expiresAt,
    updated_at: new Date().toISOString(),
  }).eq('user_email', email);
  return d.access_token as string;
}

async function callCanvaCreate(accessToken: string): Promise<Response> {
  return fetch(DESIGNS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ design_type: { type: 'preset', name: 'Presentation' } }),
  });
}

serve(async (req) => {
  const origin = req.headers.get('Origin');
  const c = cors(origin);
  if (req.method === 'OPTIONS') return new Response(null, { headers: c });

  try {
    const body = await req.json();
    const { action, email, id, prompt } = body;

    if (!email) return Response.json({ error: 'email required' }, { status: 400, headers: c });

    if (action === 'list-creations') {
      const { data, error } = await sb.from('navi_creations').select(COLS).eq('user_email', email).order('created_at', { ascending: false }).limit(20);
      if (error) throw new Error(error.message);
      return Response.json({ creations: data ?? [] }, { headers: c });
    }

    if (action === 'delete-creation') {
      if (!id) return Response.json({ error: 'id required' }, { status: 400, headers: c });
      const { error } = await sb.from('navi_creations').delete().eq('id', id).eq('user_email', email);
      if (error) throw new Error(error.message);
      return Response.json({ ok: true }, { headers: c });
    }

    if (action === 'create-creation') {
      const cleanPrompt = (prompt ?? '').trim();
      if (!cleanPrompt) return Response.json({ error: 'prompt required' }, { status: 400, headers: c });
      const title = deriveTitle(cleanPrompt);

      // Look up the user's Canva token
      const { data: tok } = await sb.from('navi_canva_tokens').select('access_token,refresh_token,expires_at').eq('user_email', email).single();

      // Canva integration not configured yet at the platform level
      if (!CLIENT_ID) {
        const { data: row } = await sb.from('navi_creations').insert({
          user_email: email, title, prompt: cleanPrompt, status: 'pending',
        }).select(COLS).single();
        return Response.json({ ...(row ?? {}), naviMessage: MSG_SETUP_PENDING }, { headers: c });
      }

      // User has not connected Canva
      if (!tok) {
        const { data: row } = await sb.from('navi_creations').insert({
          user_email: email, title, prompt: cleanPrompt, status: 'pending',
        }).select(COLS).single();
        return Response.json({ ...(row ?? {}), naviMessage: MSG_NEEDS_AUTH, needsCanvaAuth: true }, { headers: c });
      }

      // Insert as processing
      const { data: row, error: insErr } = await sb.from('navi_creations').insert({
        user_email: email, title, prompt: cleanPrompt, status: 'processing',
      }).select(COLS).single();
      if (insErr || !row) throw new Error(insErr?.message ?? 'insert failed');

      // Resolve a usable access token (refresh if expired)
      let accessToken = tok.access_token as string;
      const expired = tok.expires_at ? new Date(tok.expires_at).getTime() - Date.now() < 60_000 : false;
      if (expired && tok.refresh_token) {
        try { accessToken = await refreshUserToken(email, tok.refresh_token as string); } catch { /* fall through, API call will 401 */ }
      }

      try {
        let r = await callCanvaCreate(accessToken);

        // 401: try a refresh + single retry
        if (r.status === 401 && tok.refresh_token) {
          try {
            accessToken = await refreshUserToken(email, tok.refresh_token as string);
            r = await callCanvaCreate(accessToken);
          } catch { /* handled below */ }
        }

        if (r.status === 401) {
          // Stale token unusable: remove it and ask user to reconnect
          await sb.from('navi_canva_tokens').delete().eq('user_email', email);
          await sb.from('navi_creations').update({ status: 'pending', updated_at: new Date().toISOString() }).eq('id', row.id).eq('user_email', email);
          return Response.json({ ...row, status: 'pending', naviMessage: MSG_NEEDS_AUTH, needsCanvaAuth: true }, { headers: c });
        }

        if (!r.ok) {
          const { data: upd } = await sb.from('navi_creations').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', row.id).eq('user_email', email).select(COLS).single();
          return Response.json({ ...(upd ?? { ...row, status: 'failed' }), naviMessage: MSG_FAILED }, { headers: c });
        }

        const d = await r.json();
        const design = d.design ?? d;
        const designId = design?.id ?? null;
        const editUrl = design?.urls?.edit_url ?? '';
        const exportUrl = design?.urls?.view_url ?? '';

        const { data: upd } = await sb.from('navi_creations').update({
          status: 'ready',
          canva_design_id: designId,
          canva_edit_url: editUrl,
          canva_export_url: exportUrl,
          updated_at: new Date().toISOString(),
        }).eq('id', row.id).eq('user_email', email).select(COLS).single();
        return Response.json({ ...(upd ?? { ...row, status: 'ready', canva_design_id: designId, canva_edit_url: editUrl, canva_export_url: exportUrl }), naviMessage: MSG_READY }, { headers: c });
      } catch (_e) {
        const { data: upd } = await sb.from('navi_creations').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', row.id).eq('user_email', email).select(COLS).single();
        return Response.json({ ...(upd ?? { ...row, status: 'failed' }), naviMessage: MSG_FAILED }, { headers: c });
      }
    }

    return Response.json({ error: 'unknown action' }, { status: 400, headers: c });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500, headers: cors(req.headers.get('Origin')) });
  }
});
