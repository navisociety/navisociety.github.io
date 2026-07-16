// navi-share: Share tool edge function. Persists the connected-account slots
// and the share history that ShareScreen previously kept in localStorage.
// State lives in Supabase Storage as per-user JSON (accounts.json +
// shares.json) plus the uploaded media files — a new Postgres table would
// need DDL via the out-of-band management token, but the service role can
// manage Storage directly, including creating the bucket on first use.
// Direct posting to the platforms is NOT implemented (that needs per-platform
// developer apps + OAuth); a share is stored at original quality with its
// caption and target platforms, ready for when posting lands.
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

const BUCKET = 'navi-share';
const PLATFORMS = ['Instagram', 'TikTok', 'Facebook', 'YouTube', 'X'];
const MAX_SHARES = 100;
const MAX_CAPTION = 2200; // Instagram's caption ceiling — the strictest of the five
const MAX_HANDLE = 30;
const MAX_MEDIA_BYTES = 10 * 1024 * 1024; // 10MB — edge function JSON body limit minus base64 overhead

const ALLOWED_MEDIA_TYPES: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

export interface ConnectedAccount {
  platform: string;
  handle: string;
  connectedAt: string;
}

export interface ShareMedia {
  url: string;
  contentType: string;
  name: string;
  size: number;
}

export interface ShareRecord {
  id: string;
  caption: string;
  platforms: string[];
  media: ShareMedia | null;
  createdAt: string;
}

export function isPlatform(v: unknown): boolean {
  return PLATFORMS.includes(v as string);
}

export function cleanHandle(raw: unknown): string {
  return String(raw ?? '').trim().replace(/^@+/, '').replace(/\s+/g, '').slice(0, MAX_HANDLE);
}

export function clampCaption(raw: unknown): string {
  return String(raw ?? '').trim().slice(0, MAX_CAPTION);
}

export function extForType(contentType: unknown): string | null {
  return ALLOWED_MEDIA_TYPES[contentType as string] ?? null;
}

export function upsertAccount(
  list: ConnectedAccount[], platform: string, handle: string, now: string,
): ConnectedAccount[] {
  return [...list.filter(a => a.platform !== platform), { platform, handle, connectedAt: now }];
}

export function removeAccount(list: ConnectedAccount[], platform: string): ConnectedAccount[] {
  return list.filter(a => a.platform !== platform);
}

export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// storage path segment safe encoding of an email (no '@'/'.' folder weirdness)
export function emailToFolder(email: string): string {
  return email.toLowerCase().replace(/[^a-z0-9]/g, '_');
}

// --- Storage-backed state ------------------------------------------------

let bucketReady = false;
async function ensureBucket() {
  if (bucketReady) return;
  const { error } = await sb.storage.createBucket(BUCKET, { public: true });
  // "already exists" is the normal warm path; anything else surfaces later
  // when the actual read/write fails, so don't throw here.
  if (!error || /already exists/i.test(error.message)) bucketReady = true;
}

async function readJson<T>(path: string, fallback: T): Promise<T> {
  const { data, error } = await sb.storage.from(BUCKET).download(path);
  if (error || !data) return fallback;
  try {
    return JSON.parse(await data.text()) as T;
  } catch {
    return fallback;
  }
}

async function writeJson(path: string, value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  const { error } = await sb.storage.from(BUCKET).upload(path, bytes, {
    contentType: 'application/json',
    upsert: true,
  });
  if (error) throw new Error(error.message);
}

const accountsPath = (email: string) => `${emailToFolder(email)}/accounts.json`;
const sharesPath = (email: string) => `${emailToFolder(email)}/shares.json`;

serve(async (req) => {
  const origin = req.headers.get('Origin');
  const c = cors(origin);
  if (req.method === 'OPTIONS') return new Response(null, { headers: c });

  try {
    const body = await req.json();
    const { action, email, id } = body;

    if (!email) return Response.json({ error: 'email required' }, { status: 400, headers: c });
    await ensureBucket();

    if (action === 'get-accounts') {
      const accounts = await readJson<ConnectedAccount[]>(accountsPath(email), []);
      return Response.json({ accounts }, { headers: c });
    }

    if (action === 'connect') {
      const platform = body.platform as string;
      if (!isPlatform(platform)) return Response.json({ error: 'unknown platform' }, { status: 400, headers: c });
      const handle = cleanHandle(body.handle);
      if (!handle) return Response.json({ error: 'Enter your username to connect.' }, { status: 400, headers: c });

      const accounts = await readJson<ConnectedAccount[]>(accountsPath(email), []);
      const next = upsertAccount(accounts, platform, handle, new Date().toISOString());
      await writeJson(accountsPath(email), next);
      return Response.json({ accounts: next }, { headers: c });
    }

    if (action === 'disconnect') {
      const platform = body.platform as string;
      if (!isPlatform(platform)) return Response.json({ error: 'unknown platform' }, { status: 400, headers: c });

      const accounts = await readJson<ConnectedAccount[]>(accountsPath(email), []);
      const next = removeAccount(accounts, platform);
      await writeJson(accountsPath(email), next);
      return Response.json({ accounts: next }, { headers: c });
    }

    if (action === 'list-shares') {
      const shares = await readJson<ShareRecord[]>(sharesPath(email), []);
      return Response.json({ shares }, { headers: c });
    }

    if (action === 'create-share') {
      const caption = clampCaption(body.caption);
      const dataBase64 = body.dataBase64 as string | undefined;
      const contentType = body.contentType as string | undefined;

      if (!caption && !dataBase64) {
        return Response.json({ error: 'Add an image, video or caption to share.' }, { status: 400, headers: c });
      }

      const accounts = await readJson<ConnectedAccount[]>(accountsPath(email), []);
      if (accounts.length === 0) {
        return Response.json({ error: 'Connect at least one account first.' }, { status: 400, headers: c });
      }

      const shares = await readJson<ShareRecord[]>(sharesPath(email), []);
      if (shares.length >= MAX_SHARES) {
        return Response.json({ error: 'Share history is full (max 100). Delete some shares first.' }, { status: 400, headers: c });
      }

      let media: ShareMedia | null = null;
      if (dataBase64) {
        const ext = extForType(contentType);
        if (!ext) return Response.json({ error: 'Unsupported file type. Use PNG, JPEG, WEBP, GIF, MP4, WEBM or MOV.' }, { status: 400, headers: c });

        const bytes = base64ToBytes(dataBase64);
        if (bytes.byteLength > MAX_MEDIA_BYTES) return Response.json({ error: 'File too large (max 10MB for now).' }, { status: 400, headers: c });

        const path = `${emailToFolder(email)}/media/${crypto.randomUUID()}.${ext}`;
        const { error: upErr } = await sb.storage.from(BUCKET).upload(path, bytes, { contentType, upsert: false });
        if (upErr) throw new Error(upErr.message);

        const { data: pub } = sb.storage.from(BUCKET).getPublicUrl(path);
        media = {
          url: pub.publicUrl,
          contentType: contentType!,
          name: String(body.fileName ?? '').slice(0, 120) || `share.${ext}`,
          size: bytes.byteLength,
        };
      }

      const share: ShareRecord = {
        id: crypto.randomUUID(),
        caption,
        platforms: accounts.map(a => a.platform),
        media,
        createdAt: new Date().toISOString(),
      };
      await writeJson(sharesPath(email), [share, ...shares]);
      return Response.json({ share }, { headers: c });
    }

    if (action === 'delete-share') {
      if (!id) return Response.json({ error: 'id required' }, { status: 400, headers: c });

      const shares = await readJson<ShareRecord[]>(sharesPath(email), []);
      const row = shares.find(s => s.id === id) ?? null;
      if (!row) return Response.json({ error: 'share not found' }, { status: 404, headers: c });

      await writeJson(sharesPath(email), shares.filter(s => s.id !== id));

      // Best-effort cleanup of the stored file if it lives in our bucket.
      if (row.media?.url?.includes(`/${BUCKET}/`)) {
        const marker = `/object/public/${BUCKET}/`;
        const idx = row.media.url.indexOf(marker);
        if (idx >= 0) {
          const path = row.media.url.slice(idx + marker.length);
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
