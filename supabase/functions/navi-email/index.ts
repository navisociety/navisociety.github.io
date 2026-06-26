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

const CLIENT_ID = Deno.env.get('GOOGLE_CLIENT_ID') ?? '';
const CLIENT_SECRET = Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '';
const REDIRECT_URI = 'https://navisociety.github.io';
const SCOPE = 'https://www.googleapis.com/auth/gmail.modify';

async function refreshToken(rt: string) {
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ refresh_token: rt, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, grant_type: 'refresh_token' }),
  });
  if (!r.ok) throw new Error('Token refresh failed');
  const d = await r.json();
  return { access_token: d.access_token as string, expires_at: new Date(Date.now() + d.expires_in * 1000) };
}

async function getToken(userEmail: string): Promise<string> {
  const { data } = await sb.from('navi_gmail_tokens').select('access_token,refresh_token,expires_at').eq('user_email', userEmail).single();
  if (!data) throw new Error('Gmail not connected');
  if (new Date(data.expires_at).getTime() - Date.now() < 120_000) {
    const fresh = await refreshToken(data.refresh_token);
    await sb.from('navi_gmail_tokens').update({ access_token: fresh.access_token, expires_at: fresh.expires_at.toISOString(), updated_at: new Date().toISOString() }).eq('user_email', userEmail);
    return fresh.access_token;
  }
  return data.access_token;
}

function b64url(s: string): string {
  try {
    const base64 = s.replace(/-/g, '+').replace(/_/g, '/');
    const bin = atob(base64);
    return decodeURIComponent(bin.split('').map(c => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join(''));
  } catch { return ''; }
}

function toB64url(s: string): string {
  return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function hdr(headers: { name: string; value: string }[], name: string) {
  return headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value ?? '';
}

function extractBody(payload: { body?: { data?: string }; parts?: { mimeType: string; body?: { data?: string } }[] }): string {
  if (payload.body?.data) return b64url(payload.body.data);
  if (payload.parts) {
    const plain = payload.parts.find(p => p.mimeType === 'text/plain');
    if (plain?.body?.data) return b64url(plain.body.data);
    const html = payload.parts.find(p => p.mimeType === 'text/html');
    if (html?.body?.data) return b64url(html.body.data).replace(/<[^>]+>/g, '');
  }
  return '';
}

function buildMime(to: string, from: string, subject: string, body: string): string {
  const mime = [`From: ${from}`, `To: ${to}`, `Subject: ${subject}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', '', body].join('\r\n');
  return toB64url(mime);
}

async function gGet(token: string, path: string) {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok) throw new Error(`Gmail ${r.status}: ${await r.text()}`);
  return r.json();
}
async function gPost(token: string, path: string, body: unknown) {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Gmail ${r.status}: ${await r.text()}`);
  return r.json();
}
async function gPut(token: string, path: string, body: unknown) {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { method: 'PUT', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!r.ok) throw new Error(`Gmail ${r.status}: ${await r.text()}`);
  return r.json();
}
async function gDelete(token: string, path: string) {
  const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/${path}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
  if (!r.ok && r.status !== 204) throw new Error(`Gmail ${r.status}`);
}

serve(async (req) => {
  const origin = req.headers.get('Origin');
  const c = cors(origin);
  if (req.method === 'OPTIONS') return new Response(null, { headers: c });

  try {
    const body = await req.json();
    const { action, email, code, messageId, draftId, to, subject, body: msgBody } = body;

    if (action === 'auth-url') {
      if (!CLIENT_ID) return Response.json({ error: 'Google OAuth not configured' }, { status: 503, headers: c });
      const p = new URLSearchParams({ client_id: CLIENT_ID, redirect_uri: REDIRECT_URI, response_type: 'code', scope: SCOPE, access_type: 'offline', prompt: 'consent', state: `gmail_oauth:${email ?? ''}` });
      return Response.json({ url: `https://accounts.google.com/o/oauth2/v2/auth?${p}` }, { headers: c });
    }

    if (action === 'callback') {
      const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ code, client_id: CLIENT_ID, client_secret: CLIENT_SECRET, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' }) });
      if (!r.ok) return Response.json({ error: `Token exchange failed: ${await r.text()}` }, { status: 400, headers: c });
      const tokens = await r.json();
      const expiresAt = new Date(Date.now() + tokens.expires_in * 1000);
      const profileRes = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', { headers: { Authorization: `Bearer ${tokens.access_token}` } });
      const profile = profileRes.ok ? await profileRes.json() : {};
      await sb.from('navi_gmail_tokens').upsert({ user_email: email, access_token: tokens.access_token, refresh_token: tokens.refresh_token, expires_at: expiresAt.toISOString(), gmail_address: profile.emailAddress ?? email, updated_at: new Date().toISOString() }, { onConflict: 'user_email' });
      return Response.json({ ok: true, gmail_address: profile.emailAddress ?? email }, { headers: c });
    }

    if (action === 'check-connected') {
      const { data } = await sb.from('navi_gmail_tokens').select('gmail_address').eq('user_email', email).single();
      return Response.json({ connected: !!data, gmail_address: data?.gmail_address ?? null }, { headers: c });
    }

    if (action === 'disconnect') {
      await sb.from('navi_gmail_tokens').delete().eq('user_email', email);
      return Response.json({ ok: true }, { headers: c });
    }

    const token = await getToken(email);

    if (action === 'list-inbox') {
      const list = await gGet(token, 'messages?labelIds=INBOX&maxResults=20');
      const msgs = list.messages ?? [];
      const details = await Promise.all(msgs.map((m: { id: string }) =>
        gGet(token, `messages/${m.id}?format=metadata&metadataHeaders=Subject,From,Date,To`)
          .then((msg: { id: string; snippet: string; payload: { headers: { name: string; value: string }[] } }) => ({
            id: msg.id, snippet: msg.snippet,
            subject: hdr(msg.payload.headers, 'Subject'),
            from: hdr(msg.payload.headers, 'From'),
            to: hdr(msg.payload.headers, 'To'),
            date: hdr(msg.payload.headers, 'Date'),
          })).catch(() => null)
      ));
      return Response.json({ messages: details.filter(Boolean) }, { headers: c });
    }

    if (action === 'list-drafts') {
      const list = await gGet(token, 'drafts?maxResults=20');
      const drafts = list.drafts ?? [];
      const details = await Promise.all(drafts.map((d: { id: string }) =>
        gGet(token, `drafts/${d.id}`)
          .then((draft: { id: string; message: { id: string; snippet: string; payload: { headers: { name: string; value: string }[] } } }) => ({
            draftId: draft.id, messageId: draft.message.id, snippet: draft.message.snippet,
            subject: hdr(draft.message.payload.headers, 'Subject'),
            to: hdr(draft.message.payload.headers, 'To'),
            date: hdr(draft.message.payload.headers, 'Date'),
          })).catch(() => null)
      ));
      return Response.json({ drafts: details.filter(Boolean) }, { headers: c });
    }

    if (action === 'get-message') {
      const msg = await gGet(token, `messages/${messageId}?format=full`);
      const h = msg.payload.headers;
      return Response.json({ id: msg.id, subject: hdr(h, 'Subject'), from: hdr(h, 'From'), to: hdr(h, 'To'), date: hdr(h, 'Date'), body: extractBody(msg.payload), labelIds: msg.labelIds }, { headers: c });
    }

    if (action === 'get-draft') {
      const draft = await gGet(token, `drafts/${draftId}`);
      const h = draft.message.payload.headers;
      return Response.json({ draftId: draft.id, messageId: draft.message.id, subject: hdr(h, 'Subject'), to: hdr(h, 'To'), date: hdr(h, 'Date'), body: extractBody(draft.message.payload) }, { headers: c });
    }

    if (action === 'create-draft') {
      const { data: row } = await sb.from('navi_gmail_tokens').select('gmail_address').eq('user_email', email).single();
      const from = row?.gmail_address ?? email;
      const raw = buildMime(to ?? '', from, subject ?? '', msgBody ?? '');
      const draft = await gPost(token, 'drafts', { message: { raw } });
      return Response.json({ draftId: draft.id }, { headers: c });
    }

    if (action === 'update-draft') {
      const { data: row } = await sb.from('navi_gmail_tokens').select('gmail_address').eq('user_email', email).single();
      const from = row?.gmail_address ?? email;
      const raw = buildMime(to ?? '', from, subject ?? '', msgBody ?? '');
      const draft = await gPut(token, `drafts/${draftId}`, { message: { raw } });
      return Response.json({ draftId: draft.id }, { headers: c });
    }

    if (action === 'send-draft') {
      await gPost(token, 'drafts/send', { id: draftId });
      return Response.json({ ok: true }, { headers: c });
    }

    if (action === 'send-message') {
      const { data: row } = await sb.from('navi_gmail_tokens').select('gmail_address').eq('user_email', email).single();
      const from = row?.gmail_address ?? email;
      const raw = buildMime(to ?? '', from, subject ?? '', msgBody ?? '');
      await gPost(token, 'messages/send', { raw });
      return Response.json({ ok: true }, { headers: c });
    }

    if (action === 'trash-message') {
      await gPost(token, `messages/${messageId}/trash`, {});
      return Response.json({ ok: true }, { headers: c });
    }

    if (action === 'delete-draft') {
      await gDelete(token, `drafts/${draftId}`);
      return Response.json({ ok: true }, { headers: c });
    }

    return Response.json({ error: 'unknown action' }, { status: 400, headers: c });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500, headers: cors(req.headers.get('Origin')) });
  }
});
