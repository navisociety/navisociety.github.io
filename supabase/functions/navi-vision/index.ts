// navi-vision: Vision Board tool edge function (freely-positioned image + text goal canvas)
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

const BUCKET = 'vision-boards';
const COLS = 'id,user_email,kind,content,position,x,y,created_at';
const MAX_ITEMS = 60;

const ALLOWED_IMAGE_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // 8MB

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// storage path segment safe encoding of an email (no '@'/'.' folder weirdness)
function emailToFolder(email: string): string {
  return email.toLowerCase().replace(/[^a-z0-9]/g, '_');
}

serve(async (req) => {
  const origin = req.headers.get('Origin');
  const c = cors(origin);
  if (req.method === 'OPTIONS') return new Response(null, { headers: c });

  try {
    const body = await req.json();
    const { action, email, id } = body;

    if (!email) return Response.json({ error: 'email required' }, { status: 400, headers: c });

    if (action === 'get-profile') {
      const { data, error } = await sb.from('navi_vision_profile').select('name,bio').eq('user_email', email).maybeSingle();
      if (error) throw new Error(error.message);
      return Response.json({ profile: data ?? null }, { headers: c });
    }

    if (action === 'save-profile') {
      const name = String(body.name ?? '').trim().slice(0, 60);
      const bio = String(body.bio ?? '').trim().slice(0, 280);

      const { data, error } = await sb.from('navi_vision_profile')
        .upsert({ user_email: email, name, bio }, { onConflict: 'user_email' })
        .select('name,bio').single();
      if (error) throw new Error(error.message);
      return Response.json({ profile: data }, { headers: c });
    }

    if (action === 'list-items') {
      const { data, error } = await sb.from('navi_vision_items').select(COLS).eq('user_email', email).order('position', { ascending: true }).order('created_at', { ascending: true });
      if (error) throw new Error(error.message);
      return Response.json({ items: data ?? [] }, { headers: c });
    }

    if (action === 'add-text') {
      const text = (body.text ?? '').trim();
      if (!text) return Response.json({ error: 'text required' }, { status: 400, headers: c });

      const { count } = await sb.from('navi_vision_items').select('id', { count: 'exact', head: true }).eq('user_email', email);
      if ((count ?? 0) >= MAX_ITEMS) return Response.json({ error: 'Vision board is full (max 60 items). Delete something first.' }, { status: 400, headers: c });

      const { data: maxRow } = await sb.from('navi_vision_items').select('position').eq('user_email', email).order('position', { ascending: false }).limit(1).single();
      const nextPos = (maxRow?.position ?? -1) + 1;

      const { data, error } = await sb.from('navi_vision_items').insert({ user_email: email, kind: 'text', content: text.slice(0, 280), position: nextPos }).select(COLS).single();
      if (error) throw new Error(error.message);
      return Response.json({ item: data }, { headers: c });
    }

    if (action === 'add-image') {
      const dataBase64 = body.dataBase64 as string | undefined;
      const contentType = body.contentType as string | undefined;
      const imageUrl = (body.imageUrl ?? '').trim();

      const { count } = await sb.from('navi_vision_items').select('id', { count: 'exact', head: true }).eq('user_email', email);
      if ((count ?? 0) >= MAX_ITEMS) return Response.json({ error: 'Vision board is full (max 60 items). Delete something first.' }, { status: 400, headers: c });

      const { data: maxRow } = await sb.from('navi_vision_items').select('position').eq('user_email', email).order('position', { ascending: false }).limit(1).single();
      const nextPos = (maxRow?.position ?? -1) + 1;

      let finalUrl: string;

      if (dataBase64 && contentType) {
        const ext = ALLOWED_IMAGE_TYPES[contentType];
        if (!ext) return Response.json({ error: 'Unsupported image type. Use PNG, JPEG, WEBP, or GIF.' }, { status: 400, headers: c });

        const bytes = base64ToBytes(dataBase64);
        if (bytes.byteLength > MAX_IMAGE_BYTES) return Response.json({ error: 'Image too large (max 8MB).' }, { status: 400, headers: c });

        const path = `${emailToFolder(email)}/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await sb.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: false });
        if (upErr) throw new Error(upErr.message);

        const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
        finalUrl = pub.publicUrl;
      } else if (imageUrl) {
        try {
          const u = new URL(imageUrl);
          if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('bad protocol');
        } catch {
          return Response.json({ error: 'Invalid image URL.' }, { status: 400, headers: c });
        }
        finalUrl = imageUrl;
      } else {
        return Response.json({ error: 'Provide an image file or an image URL.' }, { status: 400, headers: c });
      }

      const { data, error } = await sb.from('navi_vision_items').insert({ user_email: email, kind: 'image', content: finalUrl, position: nextPos }).select(COLS).single();
      if (error) throw new Error(error.message);
      return Response.json({ item: data }, { headers: c });
    }

    if (action === 'move-item') {
      if (!id) return Response.json({ error: 'id required' }, { status: 400, headers: c });
      const x = Number(body.x);
      const y = Number(body.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return Response.json({ error: 'x and y must be numbers' }, { status: 400, headers: c });

      const { data, error } = await sb.from('navi_vision_items').update({ x, y }).eq('id', id).eq('user_email', email).select(COLS).single();
      if (error) throw new Error(error.message);
      return Response.json({ item: data }, { headers: c });
    }

    if (action === 'delete-item') {
      if (!id) return Response.json({ error: 'id required' }, { status: 400, headers: c });

      const { data: row } = await sb.from('navi_vision_items').select(COLS).eq('id', id).eq('user_email', email).single();
      const { error } = await sb.from('navi_vision_items').delete().eq('id', id).eq('user_email', email);
      if (error) throw new Error(error.message);

      // Best-effort cleanup of the stored file if it lives in our bucket.
      if (row?.kind === 'image' && row.content?.includes(`/${BUCKET}/`)) {
        const marker = `/object/public/${BUCKET}/`;
        const idx = row.content.indexOf(marker);
        if (idx >= 0) {
          const path = row.content.slice(idx + marker.length);
          await sb.storage.from(BUCKET).remove([path]).catch(() => {});
        }
      }

      return Response.json({ ok: true }, { headers: c });
    }

    return Response.json({ error: 'unknown action' }, { status: 400, headers: c });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500, headers: cors(req.headers.get('Origin')) });
  }
});
