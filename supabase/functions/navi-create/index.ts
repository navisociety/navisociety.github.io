// navi-create: NAVI Create tool edge function.
// Canva OAuth + pptx-import generation removed (2026-07-01) - a different
// design-generation approach is being built next. For now this just persists
// the user's prompt so nothing is lost while the new approach is designed.
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

const COLS = 'id,user_email,title,prompt,status,created_at,updated_at';

const MSG_SAVED = "Got it! I've saved your prompt.";

function deriveTitle(prompt: string): string {
  const words = (prompt ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 6).join(' ');
  return words.length > 0 ? words : 'New Creation';
}

// Exposed to _test.ts (a standalone `deno test` regression suite).
export { deriveTitle };

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
      if (!cleanPrompt) return Response.json({ error: 'Please tell me what the design should say.' }, { status: 400, headers: c });

      const title = deriveTitle(cleanPrompt);
      const { data: row, error: insErr } = await sb.from('navi_creations').insert({
        user_email: email, title, prompt: cleanPrompt, status: 'pending',
      }).select(COLS).single();
      if (insErr || !row) throw new Error(insErr?.message ?? 'insert failed');

      return Response.json({ ...row, naviMessage: MSG_SAVED }, { headers: c });
    }

    return Response.json({ error: 'unknown action' }, { status: 400, headers: c });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500, headers: cors(req.headers.get('Origin')) });
  }
});
