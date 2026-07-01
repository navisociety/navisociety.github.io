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
const DESIGNS_URL = 'https://api.canva.com/rest/v1/designs';
const EXPORTS_URL = 'https://api.canva.com/rest/v1/exports';
const IMPORTS_URL = 'https://api.canva.com/rest/v1/imports';
const PPTX_MIME = 'application/vnd.openxmlformats-officedocument.presentationml.presentation';

// Internal sentinel used to signal a Canva 401 up through the import flow so
// the caller can drop the stale token and ask the user to reconnect.
const UNAUTH = 'CANVA_UNAUTHORIZED';

const COLS = 'id,user_email,title,prompt,content,status,canva_design_id,canva_edit_url,canva_export_url,created_at,updated_at';

const MSG_READY = 'Your design is ready in Canva! Tap the button below to open and export it.';
const MSG_NEEDS_AUTH = 'Connect your Canva account first to generate designs.';
const MSG_SETUP_PENDING = 'Canva integration is being set up. Your prompt is saved and will be sent to Canva once connected.';
const MSG_FAILED = 'I ran into an issue generating your design. Please try again.';

// ---------------------------------------------------------------------------
// Prompt -> Canva design_type mapping.
//
// The Canva Connect API's POST /v1/designs only exposes FOUR real preset
// names: "doc", "email", "presentation", "whiteboard". Everything else that
// users ask for (Instagram post, poster, flyer, logo, business card, banner,
// video, etc.) does NOT exist as a preset and must be created as a "custom"
// design_type with an explicit pixel width/height. The pixel sizes below are
// the standard Canva dimensions for each format. Canva limits: each side
// 40-8000px, and width x height must not exceed 25,000,000 px^2.
// ---------------------------------------------------------------------------
type DesignType =
  | { type: 'preset'; name: 'doc' | 'email' | 'presentation' | 'whiteboard' }
  | { type: 'custom'; width: number; height: number };

const preset = (name: 'doc' | 'email' | 'presentation' | 'whiteboard'): DesignType => ({ type: 'preset', name });
const custom = (width: number, height: number): DesignType => ({ type: 'custom', width, height });

// Ordered rules: first match wins, so more specific patterns come first.
const DESIGN_RULES: Array<[RegExp, DesignType]> = [
  // Social - stories/reels/vertical video (check before generic instagram/post)
  [/\b(instagram|insta|ig)\s*(story|stories)\b|\breels?\b|\btik\s*tok\b|\bstory\b/, custom(1080, 1920)],
  [/\b(instagram|insta|ig)\b/, custom(1080, 1080)],
  [/\bfacebook\b|\bfb\s*post\b/, custom(1200, 630)],
  [/\blinked\s*in\b/, custom(1200, 627)],
  [/\btwitter\b|\btweet\b|\bx\s*post\b/, custom(1600, 900)],
  [/\bpinterest\b|\bpin\b/, custom(1000, 1500)],
  [/\byou\s*tube\s*(thumb\w*)?\b|\bthumbnail\b/, custom(1280, 720)],
  [/\byou\s*tube\b|\bvideo\b/, custom(1920, 1080)],
  // Print / marketing
  [/\bposter\b/, custom(2480, 3508)],
  [/\bflyer\b|\bflier\b|\bleaflet\b|\bhandout\b|\bpamphlet\b/, custom(2480, 3508)],
  [/\bbusiness\s*card\b/, custom(1050, 600)],
  [/\blogo\b/, custom(500, 500)],
  [/\bbanner\b|\bheader\b|\bcover\s*(photo|image)?\b/, custom(1500, 500)],
  [/\b(greeting|birthday|thank\s*you)?\s*card\b|\binvitation\b|\binvite\b/, custom(1500, 1050)],
  // Real Canva Connect presets
  [/\bresume\b|\bcv\b|\bcurriculum\s*vitae\b/, preset('doc')],
  [/\bnewsletter\b|\bemail\b|\be-?mail\b/, preset('email')],
  [/\bwhite\s*board\b|\bbrainstorm\b|\bmind\s*map\b/, preset('whiteboard')],
  [/\bdocument\b|\bdoc\b|\bletter\b|\breport\b|\bessay\b|\barticle\b|\bproposal\b/, preset('doc')],
  [/\bpresentation\b|\bslides?\b|\bslide\s*show\b|\bpitch\s*deck\b|\bdeck\b/, preset('presentation')],
];

// Fallback preset when nothing matches (preserves prior default behaviour).
const DEFAULT_DESIGN: DesignType = preset('presentation');

function deriveDesignType(prompt: string): DesignType {
  const p = (prompt ?? '').toLowerCase();
  for (const [re, dt] of DESIGN_RULES) {
    if (re.test(p)) return dt;
  }
  return DEFAULT_DESIGN;
}

// Resolve ANY design type to concrete pixel dimensions. Needed for the
// content/import path, where we generate our own source file (rather than
// asking Canva for a named preset) so the imported design comes out at the
// exact size we choose. The four Canva presets get sensible standard pixel
// equivalents; custom types pass through unchanged.
function designTypeToDims(dt: DesignType): { width: number; height: number } {
  if (dt.type === 'custom') return { width: dt.width, height: dt.height };
  switch (dt.name) {
    case 'doc': return { width: 2550, height: 3300 };          // US Letter @300dpi
    case 'email': return { width: 600, height: 800 };          // tall email graphic
    case 'presentation': return { width: 1920, height: 1080 }; // 16:9 slide
    case 'whiteboard': return { width: 1920, height: 1080 };
  }
}

// Choose an export format that suits the design_type. Multi-page document
// formats export cleanly as PDF; visual/social designs export as PNG. Both
// "pdf" and "png" have no required sub-fields, keeping the call robust.
function deriveExportFormat(dt: DesignType): Record<string, unknown> {
  if (dt.type === 'preset' && (dt.name === 'doc' || dt.name === 'presentation' || dt.name === 'email')) {
    return { type: 'pdf' };
  }
  return { type: 'png' };
}

function deriveTitle(prompt: string): string {
  const words = (prompt ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 6).join(' ');
  return words.length > 0 ? words : 'New Creation';
}

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

// Base64 of a UTF-8 string (btoa alone mangles non-Latin1 characters).
function b64utf8(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

// ---------------------------------------------------------------------------
// Build a single-slide .pptx whose slide size equals the resolved pixel
// dimensions. Standard OOXML conversion is 1px @96dpi = 9525 EMU, which
// PptxGenJS expresses via a custom layout sized in inches (px / 96). When
// Canva imports this file, the resulting design inherits this exact size AND
// keeps the title/body as real, editable text. Two text boxes only; no
// themes/animations. Body lines become separate paragraphs (real line breaks).
// ---------------------------------------------------------------------------
async function buildPptx(width: number, height: number, title: string, body: string): Promise<Uint8Array> {
  const wIn = width / 96;
  const hIn = height / 96;
  const pptx = new pptxgen();
  pptx.defineLayout({ name: 'NAVI', width: wIn, height: hIn });
  pptx.layout = 'NAVI';
  const slide = pptx.addSlide();

  const base = Math.min(width, height);
  const titleFont = clamp(Math.round(base / 22), 20, 80);
  const bodyFont = clamp(Math.round(base / 40), 12, 44);
  const marginX = wIn * 0.06;
  const contentW = wIn - marginX * 2;

  if (title) {
    slide.addText(title, {
      x: marginX, y: hIn * 0.08, w: contentW, h: hIn * 0.24,
      fontSize: titleFont, bold: true, align: 'center', valign: 'top',
      fontFace: 'Arial', color: '000000', wrap: true,
    });
  }
  if (body) {
    // Split into paragraph runs so newlines render as real line breaks.
    const runs = body.split(/\r?\n/).map((line) => ({ text: line, options: { breakLine: true } }));
    slide.addText(runs as unknown as string, {
      x: marginX, y: hIn * 0.38, w: contentW, h: hIn * 0.54,
      fontSize: bodyFont, align: title ? 'left' : 'center', valign: 'top',
      fontFace: 'Arial', color: '000000', wrap: true,
    });
  }

  const out = await pptx.write({ outputType: 'uint8array' });
  return out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer);
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

async function callCanvaCreate(accessToken: string, designType: DesignType, title: string): Promise<Response> {
  return fetch(DESIGNS_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ design_type: designType, title: title.slice(0, 255) }),
  });
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

// Kick off a Canva export job and poll (briefly) for a real downloadable URL.
// Best-effort: returns the export URL on success, or null if it fails/times
// out within the request budget. Never throws to the caller. NOTE: Canva
// export URLs expire ~24h after generation.
async function exportDesignUrl(accessToken: string, designId: string, designType: DesignType): Promise<string | null> {
  try {
    const start = await fetch(EXPORTS_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ design_id: designId, format: deriveExportFormat(designType) }),
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
    const { action, email, id, prompt, content } = body;

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

      // Optional content: first non-blank line is the title/headline, the rest
      // is body text. Pure string splitting, no AI. Drives the import path.
      const contentClean = (content ?? '').trim();
      const hasContent = contentClean.length > 0;
      let headlineLine = '';
      let bodyText = '';
      if (hasContent) {
        const lines = contentClean.split(/\r?\n/);
        const firstIdx = lines.findIndex((l: string) => l.trim() !== '');
        if (firstIdx >= 0) {
          headlineLine = lines[firstIdx].trim();
          bodyText = lines.slice(firstIdx + 1).join('\n').trim();
        }
      }

      const title = deriveTitle(cleanPrompt);
      const designType = deriveDesignType(cleanPrompt);
      const contentToStore = hasContent ? contentClean : null;

      // Look up the user's Canva token
      const { data: tok } = await sb.from('navi_canva_tokens').select('access_token,refresh_token,expires_at').eq('user_email', email).single();

      // Canva integration not configured yet at the platform level
      if (!CLIENT_ID) {
        const { data: row } = await sb.from('navi_creations').insert({
          user_email: email, title, prompt: cleanPrompt, content: contentToStore, status: 'pending',
        }).select(COLS).single();
        return Response.json({ ...(row ?? {}), naviMessage: MSG_SETUP_PENDING }, { headers: c });
      }

      // User has not connected Canva
      if (!tok) {
        const { data: row } = await sb.from('navi_creations').insert({
          user_email: email, title, prompt: cleanPrompt, content: contentToStore, status: 'pending',
        }).select(COLS).single();
        return Response.json({ ...(row ?? {}), naviMessage: MSG_NEEDS_AUTH, needsCanvaAuth: true }, { headers: c });
      }

      // Insert as processing
      const { data: row, error: insErr } = await sb.from('navi_creations').insert({
        user_email: email, title, prompt: cleanPrompt, content: contentToStore, status: 'processing',
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

      // -------------------------------------------------------------------
      // CONTENT PATH: generate a sized .pptx with real text, import it into
      // Canva as a fully-editable design of the exact detected dimensions.
      // -------------------------------------------------------------------
      if (hasContent) {
        const { width, height } = designTypeToDims(designType);

        let bytes: Uint8Array;
        try {
          bytes = await buildPptx(width, height, headlineLine, bodyText);
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
          const exportUrl = await exportDesignUrl(accessToken, imp.designId, designType);
          return await markReady(imp.designId, imp.editUrl, exportUrl);
        } catch (e) {
          if (String(e).includes(UNAUTH)) return await markNeedsAuth();
          return await markFailed();
        }
      }

      // -------------------------------------------------------------------
      // NO-CONTENT PATH (unchanged): create a blank design via POST /v1/designs.
      // -------------------------------------------------------------------
      try {
        let r = await callCanvaCreate(accessToken, designType, title);

        // 401: try a refresh + single retry
        if (r.status === 401 && tok.refresh_token) {
          try {
            accessToken = await refreshUserToken(email, tok.refresh_token as string);
            r = await callCanvaCreate(accessToken, designType, title);
          } catch { /* handled below */ }
        }

        if (r.status === 401) {
          // Stale token unusable: remove it and ask user to reconnect
          return await markNeedsAuth();
        }

        if (!r.ok) {
          return await markFailed();
        }

        const d = await r.json();
        const design = d.design ?? d;
        const designId = design?.id ?? null;
        const editUrl = design?.urls?.edit_url ?? '';

        // Real export: generate an actual downloadable file URL (best-effort).
        // Leave canva_export_url null rather than mislabeling the view_url.
        let exportUrl: string | null = null;
        if (designId) {
          exportUrl = await exportDesignUrl(accessToken, designId, designType);
        }

        return await markReady(designId, editUrl, exportUrl);
      } catch (_e) {
        return await markFailed();
      }
    }

    return Response.json({ error: 'unknown action' }, { status: 400, headers: c });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500, headers: cors(req.headers.get('Origin')) });
  }
});
