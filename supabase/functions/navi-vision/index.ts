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
const COLS = 'id,user_email,kind,content,name,notes,shape,size,position,x,y,created_at';
const MAX_ITEMS = 60;
const SHAPES = ['circle', 'square'];

function cleanShape(v: unknown): string {
  return SHAPES.includes(v as string) ? (v as string) : 'square';
}

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

// Resolve the image carried by a request body (uploaded bytes or a pasted
// URL) to its final content URL. Shared by add-image and set-image.
async function resolveImageUrl(
  body: Record<string, unknown>, email: string,
): Promise<{ url: string } | { err: string }> {
  const dataBase64 = body.dataBase64 as string | undefined;
  const contentType = body.contentType as string | undefined;
  const imageUrl = String(body.imageUrl ?? '').trim();

  if (dataBase64 && contentType) {
    const ext = ALLOWED_IMAGE_TYPES[contentType];
    if (!ext) return { err: 'Unsupported image type. Use PNG, JPEG, WEBP, or GIF.' };

    const bytes = base64ToBytes(dataBase64);
    if (bytes.byteLength > MAX_IMAGE_BYTES) return { err: 'Image too large (max 8MB).' };

    const path = `${emailToFolder(email)}/${crypto.randomUUID()}.${ext}`;
    const { error: upErr } = await sb.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: false });
    if (upErr) throw new Error(upErr.message);

    const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
    return { url: pub.publicUrl };
  }

  if (imageUrl) {
    try {
      const u = new URL(imageUrl);
      if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new Error('bad protocol');
    } catch {
      return { err: 'Invalid image URL.' };
    }
    return { url: imageUrl };
  }

  return { err: 'Provide an image file or an image URL.' };
}

// Best-effort cleanup of a stored file when its item stops pointing at it.
async function removeStoredFile(contentUrl: string | null | undefined) {
  if (!contentUrl?.includes(`/${BUCKET}/`)) return;
  const marker = `/object/public/${BUCKET}/`;
  const idx = contentUrl.indexOf(marker);
  if (idx >= 0) {
    const path = contentUrl.slice(idx + marker.length);
    await sb.storage.from(BUCKET).remove([path]).catch(() => {});
  }
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
      const name = String(body.name ?? '').trim().slice(0, 60) || text.slice(0, 60);
      const notes = String(body.notes ?? '').trim().slice(0, 280);
      const shape = cleanShape(body.shape);

      const { count } = await sb.from('navi_vision_items').select('id', { count: 'exact', head: true }).eq('user_email', email);
      if ((count ?? 0) >= MAX_ITEMS) return Response.json({ error: 'Vision board is full (max 60 items). Delete something first.' }, { status: 400, headers: c });

      const { data: maxRow } = await sb.from('navi_vision_items').select('position').eq('user_email', email).order('position', { ascending: false }).limit(1).single();
      const nextPos = (maxRow?.position ?? -1) + 1;

      const { data, error } = await sb.from('navi_vision_items').insert({ user_email: email, kind: 'text', content: text.slice(0, 280), name, notes, shape, position: nextPos }).select(COLS).single();
      if (error) throw new Error(error.message);
      return Response.json({ item: data }, { headers: c });
    }

    if (action === 'add-image') {
      const name = String(body.name ?? '').trim().slice(0, 60);
      const notes = String(body.notes ?? '').trim().slice(0, 280);
      const shape = cleanShape(body.shape);

      const { count } = await sb.from('navi_vision_items').select('id', { count: 'exact', head: true }).eq('user_email', email);
      if ((count ?? 0) >= MAX_ITEMS) return Response.json({ error: 'Vision board is full (max 60 items). Delete something first.' }, { status: 400, headers: c });

      const { data: maxRow } = await sb.from('navi_vision_items').select('position').eq('user_email', email).order('position', { ascending: false }).limit(1).single();
      const nextPos = (maxRow?.position ?? -1) + 1;

      const resolved = await resolveImageUrl(body, email);
      if ('err' in resolved) return Response.json({ error: resolved.err }, { status: 400, headers: c });

      const { data, error } = await sb.from('navi_vision_items').insert({ user_email: email, kind: 'image', content: resolved.url, name, notes, shape, position: nextPos }).select(COLS).single();
      if (error) throw new Error(error.message);
      return Response.json({ item: data }, { headers: c });
    }

    // Set or replace an item's photo. A text project becomes an image tile
    // (its name stays as the label); an image project's old stored file is
    // cleaned up after the swap.
    if (action === 'set-image') {
      if (!id) return Response.json({ error: 'id required' }, { status: 400, headers: c });

      const { data: row } = await sb.from('navi_vision_items').select(COLS).eq('id', id).eq('user_email', email).single();
      if (!row) return Response.json({ error: 'item not found' }, { status: 404, headers: c });

      const resolved = await resolveImageUrl(body, email);
      if ('err' in resolved) return Response.json({ error: resolved.err }, { status: 400, headers: c });

      const { data, error } = await sb.from('navi_vision_items').update({ kind: 'image', content: resolved.url }).eq('id', id).eq('user_email', email).select(COLS).single();
      if (error) throw new Error(error.message);

      if (row.kind === 'image' && row.content !== resolved.url) await removeStoredFile(row.content);

      return Response.json({ item: data }, { headers: c });
    }

    if (action === 'update-item') {
      if (!id) return Response.json({ error: 'id required' }, { status: 400, headers: c });
      const name = String(body.name ?? '').trim().slice(0, 60);
      if (!name) return Response.json({ error: 'name required' }, { status: 400, headers: c });
      const notes = String(body.notes ?? '').trim().slice(0, 280);
      const shape = cleanShape(body.shape);

      const { data: row } = await sb.from('navi_vision_items').select('kind').eq('id', id).eq('user_email', email).single();
      if (!row) return Response.json({ error: 'item not found' }, { status: 404, headers: c });

      // Text tiles display their content, so keep it in sync with the name.
      const patch: Record<string, unknown> = { name, notes, shape };
      if (row.kind === 'text') patch.content = name;

      const { data, error } = await sb.from('navi_vision_items').update(patch).eq('id', id).eq('user_email', email).select(COLS).single();
      if (error) throw new Error(error.message);
      return Response.json({ item: data }, { headers: c });
    }

    if (action === 'resize-item') {
      if (!id) return Response.json({ error: 'id required' }, { status: 400, headers: c });
      const size = Number(body.size);
      if (!Number.isFinite(size)) return Response.json({ error: 'size must be a number' }, { status: 400, headers: c });
      const clamped = Math.max(0.5, Math.min(2.5, size));

      const { data, error } = await sb.from('navi_vision_items').update({ size: clamped }).eq('id', id).eq('user_email', email).select(COLS).single();
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

      if (row?.kind === 'image') await removeStoredFile(row.content);

      return Response.json({ ok: true }, { headers: c });
    }

    return Response.json({ error: 'unknown action' }, { status: 400, headers: c });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500, headers: cors(req.headers.get('Origin')) });
  }
});
