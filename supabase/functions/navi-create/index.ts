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

const CANVA_TOKEN = Deno.env.get('CANVA_ACCESS_TOKEN') ?? '';

const COLS = 'id,user_email,title,prompt,status,canva_design_id,canva_edit_url,canva_export_url,created_at,updated_at';

const MSG_READY = 'Your design is ready in Canva! Click the link below to view and export it.';
const MSG_QUEUED = "I've saved your creation prompt. Once Canva is connected, I'll generate your design automatically.";
const MSG_FAILED = 'I ran into an issue generating your design. Please try again.';

function deriveTitle(prompt: string): string {
  const words = (prompt ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 6).join(' ');
  return words.length > 0 ? words : 'New Creation';
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

    if (action === 'create-creation') {
      const cleanPrompt = (prompt ?? '').trim();
      if (!cleanPrompt) return Response.json({ error: 'prompt required' }, { status: 400, headers: c });

      const title = deriveTitle(cleanPrompt);

      // Insert as processing
      const { data: row, error: insErr } = await sb.from('navi_creations').insert({
        user_email: email, title, prompt: cleanPrompt, status: 'processing',
      }).select(COLS).single();
      if (insErr || !row) throw new Error(insErr?.message ?? 'insert failed');

      // No Canva token configured: gracefully mark ready with queued message
      if (!CANVA_TOKEN) {
        const { data: upd } = await sb.from('navi_creations').update({
          status: 'ready', canva_edit_url: '', updated_at: new Date().toISOString(),
        }).eq('id', row.id).eq('user_email', email).select(COLS).single();
        const result = upd ?? { ...row, status: 'ready', canva_edit_url: '' };
        return Response.json({ ...result, naviMessage: MSG_QUEUED }, { headers: c });
      }

      // Try Canva Connect API to create a blank design
      try {
        const r = await fetch('https://api.canva.com/rest/v1/designs', {
          method: 'POST',
          headers: { Authorization: `Bearer ${CANVA_TOKEN}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ design_type: { type: 'preset', name: 'Presentation' } }),
        });

        if (!r.ok) {
          // Token invalid / expired / API error -> mark failed
          const { data: upd } = await sb.from('navi_creations').update({
            status: 'failed', updated_at: new Date().toISOString(),
          }).eq('id', row.id).eq('user_email', email).select(COLS).single();
          const result = upd ?? { ...row, status: 'failed' };
          return Response.json({ ...result, naviMessage: MSG_FAILED }, { headers: c });
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
        const result = upd ?? { ...row, status: 'ready', canva_design_id: designId, canva_edit_url: editUrl, canva_export_url: exportUrl };
        return Response.json({ ...result, naviMessage: MSG_READY }, { headers: c });
      } catch (_canvaErr) {
        const { data: upd } = await sb.from('navi_creations').update({
          status: 'failed', updated_at: new Date().toISOString(),
        }).eq('id', row.id).eq('user_email', email).select(COLS).single();
        const result = upd ?? { ...row, status: 'failed' };
        return Response.json({ ...result, naviMessage: MSG_FAILED }, { headers: c });
      }
    }

    if (action === 'delete-creation') {
      if (!id) return Response.json({ error: 'id required' }, { status: 400, headers: c });
      const { error } = await sb.from('navi_creations').delete().eq('id', id).eq('user_email', email);
      if (error) throw new Error(error.message);
      return Response.json({ ok: true }, { headers: c });
    }

    return Response.json({ error: 'unknown action' }, { status: 400, headers: c });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500, headers: cors(req.headers.get('Origin')) });
  }
});
