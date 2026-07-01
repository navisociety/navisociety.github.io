// navi-create: NAVI Create tool edge function (per-user Canva integration)
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import pptxgen from 'https://esm.sh/pptxgenjs@3.12.0';

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
const EXPORTS_URL = 'https://api.canva.com/rest/v1/exports';
const IMPORTS_URL = 'https://api.canva.com/rest/v1/imports';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

// Every design NAVI creates is the same fixed size. No more guessing a size
// from what the user typed - that guessing was unreliable, so it's gone.
const DESIGN_WIDTH = 1080;
const DESIGN_HEIGHT = 1920;

// Internal sentinel used to signal a Canva 401 up through the import flow so
// the caller can drop the stale token and ask the user to reconnect.
const UNAUTH = 'CANVA_UNAUTHORIZED';

const COLS = 'id,user_email,title,prompt,status,canva_design_id,canva_edit_url,canva_export_url,created_at,updated_at';

const MSG_READY = 'Your design is ready in Canva! Tap the button below to open and export it.';
const MSG_NEEDS_AUTH = 'Connect your Canva account first to generate designs.';
const MSG_SETUP_PENDING = 'Canva integration is being set up. Your prompt is saved and will be sent to Canva once connected.';
const MSG_FAILED = 'I ran into an issue generating your design. Please try again.';

function deriveTitle(prompt: string): string {
  const words = (prompt ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 6).join(' ');
  return words.length > 0 ? words : 'New Creation';
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// ---------------------------------------------------------------------------
// The single prompt box's text becomes the design's content: first non-blank
// line is the headline, everything after it is the body. Pure string
// splitting, zero AI (see feedback_anthropic_key_tier_restriction).
// ---------------------------------------------------------------------------
interface SlideContent {
  heading: string;
  body: string;
}

function extractHeadlineBody(text: string): SlideContent {
  const lines = text.split(/\r?\n/);
  const firstIdx = lines.findIndex((l) => l.trim() !== '');
  if (firstIdx < 0) return { heading: '', body: '' };
  const heading = lines[firstIdx].trim();
  const body = lines.slice(firstIdx + 1).join('\n').trim();
  return { heading, body };
}

// ---------------------------------------------------------------------------
// Shrink-to-fit sizing. estimateLines/fitFontSize simulate greedy word-wrap
// at a given font size and shrink (in 2pt steps, down to a floor) until the
// text is estimated to fit its box, so typed text doesn't silently overflow.
// ---------------------------------------------------------------------------
function estimateLines(text: string, fontPt: number, boxWidthIn: number): number {
  if (!text) return 1;
  const avgCharWidthIn = (fontPt * 0.52) / 72;
  const charsPerLine = Math.max(1, Math.floor(boxWidthIn / avgCharWidthIn));
  const words = text.split(/\s+/).filter(Boolean);
  let lines = 1;
  let lineLen = 0;
  for (const w of words) {
    const wLen = w.length + 1;
    if (lineLen + wLen > charsPerLine && lineLen > 0) { lines++; lineLen = wLen; }
    else lineLen += wLen;
  }
  return lines;
}

function fitFontSize(paragraphs: string[], boxWidthIn: number, boxHeightIn: number, startFont: number, minFont: number): number {
  let font = startFont;
  while (font > minFont) {
    const lineHeightIn = (font * 1.25) / 72;
    const totalLines = paragraphs.reduce((sum, p) => sum + estimateLines(p, font, boxWidthIn), 0);
    if (totalLines * lineHeightIn <= boxHeightIn) return font;
    font -= 2;
  }
  return minFont;
}

// Base64 of a UTF-8 string (btoa alone mangles non-Latin1 characters).
function b64utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// ---------------------------------------------------------------------------
// Build a single-slide .pptx sized to exactly DESIGN_WIDTH x DESIGN_HEIGHT
// (standard OOXML conversion: 1px @96dpi = 9525 EMU, expressed here as inches
// via PptxGenJS's custom layout). When Canva imports this file, the design
// comes out at the exact size with the heading/body as real, editable text -
// color/font/size can then be changed freely inside Canva itself.
// ---------------------------------------------------------------------------
async function buildPptx(heading: string, body: string): Promise<Uint8Array> {
  const wIn = DESIGN_WIDTH / 96;
  const hIn = DESIGN_HEIGHT / 96;
  const pptx = new pptxgen();
  pptx.defineLayout({ name: 'NAVI', width: wIn, height: hIn });
  pptx.layout = 'NAVI';

  const textColor = '000000';
  const fontFace = 'Arial';

  const base = Math.min(DESIGN_WIDTH, DESIGN_HEIGHT);
  const baseTitleFont = clamp(Math.round(base / 22), 20, 80);
  const baseBodyFont = clamp(Math.round(base / 40), 12, 44);

  const marginX = wIn * 0.06;
  const contentW = wIn - marginX * 2;
  const titleBoxH = hIn * 0.24;
  const bodyBoxH = hIn * 0.54;

  const slide = pptx.addSlide();

  if (heading) {
    const titleFont = fitFontSize([heading], contentW, titleBoxH, baseTitleFont, 14);
    slide.addText(heading, {
      x: marginX, y: hIn * 0.08, w: contentW, h: titleBoxH,
      fontSize: titleFont, bold: true, align: 'center', valign: 'top',
      fontFace, color: textColor, wrap: true,
    });
  }
  if (body) {
    const bodyLines = body.split(/\r?\n/);
    const bodyFont = fitFontSize(bodyLines, contentW, bodyBoxH, baseBodyFont, 10);
    const runs = bodyLines.map((line) => ({ text: line, options: { breakLine: true } }));
    slide.addText(runs as unknown as string, {
      x: marginX, y: hIn * 0.38, w: contentW, h: bodyBoxH,
      fontSize: bodyFont, align: heading ? 'left' : 'center', valign: 'top',
      fontFace, color: textColor, wrap: true,
    });
  }

  const out = await pptx.write({ outputType: 'uint8array' });
  return out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer);
}

// Purely additive: exposes the pure-logic functions above to _test.ts (a
// standalone `deno test` regression suite, not part of the request handler
// below). Does not change the runtime behavior of the serve() handler.
export {
  deriveTitle, clamp, extractHeadlineBody, estimateLines, fitFontSize, buildPptx,
  DESIGN_WIDTH, DESIGN_HEIGHT,
};
export type { SlideContent };

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

// ---------------------------------------------------------------------------
// Design Import: upload a .pptx file and let Canva convert it into a real,
// fully-editable design of the exact size baked into the file.
//
// Request (per canva.dev Design Import API reference):
//   POST https://api.canva.com/rest/v1/imports
//   Authorization: Bearer {token}
//   Content-Type: application/octet-stream
//   Import-Metadata: {"title_base64":"<b64>","mime_type":"<mime>"}
//   body: raw file bytes
//
// Response (both POST and GET .../imports/{jobId}):
//   { job: { id, status: "in_progress"|"success"|"failed",
//            result: { designs: [ { id, urls: { edit_url, view_url } } ] },
//            error: { code, message } } }
//
// Returns the imported design's id + edit_url on success, null on
// failure/timeout, and throws UNAUTH on a 401 so the caller can reconnect.
// ---------------------------------------------------------------------------
function pickImportedDesign(job: any): { designId: string; editUrl: string } | null {
  const dsn = job?.result?.designs?.[0];
  if (!dsn?.id) return null;
  return { designId: dsn.id as string, editUrl: (dsn.urls?.edit_url as string) ?? '' };
}

async function importDesign(accessToken: string, bytes: Uint8Array, title: string): Promise<{ designId: string; editUrl: string } | null> {
  const metadata = JSON.stringify({ title_base64: b64utf8(title.slice(0, 50)), mime_type: PPTX_MIME });
  const start = await fetch(IMPORTS_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/octet-stream',
      'Import-Metadata': metadata,
    },
    // Deno fetch accepts a Uint8Array body directly; cast satisfies the
    // stricter typed-array lib generics without changing runtime behaviour.
    body: bytes as unknown as BodyInit,
  });
  if (start.status === 401) throw new Error(UNAUTH);
  if (!start.ok) return null;

  const sd = await start.json();
  let job = sd.job ?? sd;
  if (job?.status === 'success') return pickImportedDesign(job);
  if (job?.status === 'failed') return null;
  const jobId = job?.id;
  if (!jobId) return null;

  // Poll up to ~18s (single-slide imports normally finish in a few seconds).
  for (let i = 0; i < 12; i++) {
    await sleep(1500);
    const r = await fetch(`${IMPORTS_URL}/${jobId}`, { headers: { Authorization: `Bearer ${accessToken}` } });
    if (r.status === 401) throw new Error(UNAUTH);
    if (!r.ok) continue;
    const d = await r.json();
    job = d.job ?? d;
    if (job?.status === 'success') return pickImportedDesign(job);
    if (job?.status === 'failed') return null;
  }
  return null;
}

// Kick off a Canva export job (always PNG - every design is the same fixed
// custom size, never a document/presentation preset) and poll (briefly) for
// a real downloadable URL. Best-effort: returns the export URL on success, or
// null if it fails/times out within the request budget. Never throws to the
// caller. NOTE: Canva export URLs expire ~24h after generation.
async function exportDesignUrl(accessToken: string, designId: string): Promise<string | null> {
  try {
    const start = await fetch(EXPORTS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ design_id: designId, format: { type: 'png' } }),
    });
    if (!start.ok) return null;
    const sd = await start.json();
    let job = sd.job ?? sd;
    if (job?.status === 'success') return job?.urls?.[0] ?? null;
    const jobId = job?.id;
    if (!jobId) return null;

    // Poll up to ~5s total (blank/new designs usually finish in 1-2 polls).
    for (let i = 0; i < 6; i++) {
      await sleep(800);
      const r = await fetch(`${EXPORTS_URL}/${jobId}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!r.ok) continue;
      const d = await r.json();
      job = d.job ?? d;
      if (job?.status === 'success') return job?.urls?.[0] ?? null;
      if (job?.status === 'failed') return null;
    }
    return null;
  } catch {
    return null;
  }
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
      if (!cleanPrompt) return Response.json({ error: 'Please tell me what the design should say.' }, { status: 400, headers: c });

      const title = deriveTitle(cleanPrompt);
      const { heading, body: bodyText } = extractHeadlineBody(cleanPrompt);

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

      // Shared helpers for terminal states.
      const markFailed = async () => {
        const { data: upd } = await sb.from('navi_creations').update({ status: 'failed', updated_at: new Date().toISOString() }).eq('id', row.id).eq('user_email', email).select(COLS).single();
        return Response.json({ ...(upd ?? { ...row, status: 'failed' }), naviMessage: MSG_FAILED }, { headers: c });
      };
      const markNeedsAuth = async () => {
        await sb.from('navi_canva_tokens').delete().eq('user_email', email);
        await sb.from('navi_creations').update({ status: 'pending', updated_at: new Date().toISOString() }).eq('id', row.id).eq('user_email', email);
        return Response.json({ ...row, status: 'pending', naviMessage: MSG_NEEDS_AUTH, needsCanvaAuth: true }, { headers: c });
      };
      const markReady = async (designId: string | null, editUrl: string, exportUrl: string | null) => {
        const { data: upd } = await sb.from('navi_creations').update({
          status: 'ready',
          canva_design_id: designId,
          canva_edit_url: editUrl,
          canva_export_url: exportUrl,
          updated_at: new Date().toISOString(),
        }).eq('id', row.id).eq('user_email', email).select(COLS).single();
        return Response.json({ ...(upd ?? { ...row, status: 'ready', canva_design_id: designId, canva_edit_url: editUrl, canva_export_url: exportUrl }), naviMessage: MSG_READY }, { headers: c });
      };

      let bytes: Uint8Array;
      try {
        bytes = await buildPptx(heading, bodyText);
      } catch (_e) {
        return await markFailed();
      }

      try {
        let imp: { designId: string; editUrl: string } | null;
        try {
          imp = await importDesign(accessToken, bytes, title);
        } catch (e) {
          // 401 on the initial upload: refresh once and retry the whole import.
          if (!String(e).includes(UNAUTH) || !tok.refresh_token) throw e;
          try {
            accessToken = await refreshUserToken(email, tok.refresh_token as string);
            imp = await importDesign(accessToken, bytes, title);
          } catch { throw new Error(UNAUTH); }
        }

        if (!imp) return await markFailed();

        // Best-effort downloadable export (works on any design id).
        const exportUrl = await exportDesignUrl(accessToken, imp.designId);
        return await markReady(imp.designId, imp.editUrl, exportUrl);
      } catch (e) {
        if (String(e).includes(UNAUTH)) return await markNeedsAuth();
        return await markFailed();
      }
    }

    return Response.json({ error: 'unknown action' }, { status: 400, headers: c });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500, headers: cors(req.headers.get('Origin')) });
  }
});
