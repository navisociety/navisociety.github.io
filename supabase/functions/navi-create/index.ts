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
  // Cover/header/banner variants - checked first since the generic banner/cover
  // catch-all further down would otherwise swallow these more specific asks.
  [/\bfacebook\s*(cover|banner)\b/, custom(820, 312)],
  [/\blinked\s*in\s*(banner|cover)\b/, custom(1584, 396)],
  [/\b(twitter|x)\s*(header|banner|cover)\b/, custom(1500, 500)],
  [/\byou\s*tube\s*(banner|cover|channel\s*art)\b/, custom(2560, 1440)],
  [/\bbook\s*cover\b/, custom(1600, 2400)],
  [/\balbum\s*cover\b/, custom(3000, 3000)],
  [/\bpodcast\s*(cover|art)?\b/, custom(3000, 3000)],
  // Social - stories/reels/vertical video (check before generic instagram/post).
  // Bare "story"/"video"/"pin" are deliberately NOT matched here - they're
  // ordinary English words (Bible story, testimony, sermon video, "pin this
  // up on the board") that would misfire on faith-platform content when
  // combined with a more specific type elsewhere in the same prompt (e.g. "a
  // poster telling the story of..." should stay a poster). They're demoted to
  // low-priority fallback rules at the very end of DESIGN_RULES instead, so
  // anything more specific mentioned anywhere in the prompt wins first.
  [/\b(instagram|insta|ig)\s*(story|stories)\b|\breels?\b|\btik\s*tok\b|\bvertical\s*(video|story)\b/, custom(1080, 1920)],
  [/\b(instagram|insta|ig)\b/, custom(1080, 1080)],
  [/\bfacebook\b|\bfb\s*post\b/, custom(1200, 630)],
  [/\blinked\s*in\b/, custom(1200, 627)],
  [/\btwitter\b|\btweet\b|\bx\s*post\b/, custom(1600, 900)],
  [/\bpinterest\b/, custom(1000, 1500)],
  [/\byou\s*tube\s*(thumb\w*)?\b|\bthumbnail\b/, custom(1280, 720)],
  [/\byou\s*tube\b/, custom(1920, 1080)],
  [/\bzoom\s*background\b|\bvirtual\s*background\b/, custom(1920, 1080)],
  // Print / marketing
  [/\bposter\b/, custom(2480, 3508)],
  [/\bflyer\b|\bflier\b|\bleaflet\b|\bhandout\b|\bpamphlet\b/, custom(2480, 3508)],
  [/\bpostcard\b/, custom(1500, 1050)],
  [/\bbusiness\s*card\b/, custom(1050, 600)],
  [/\bname\s*tag\b|\bbadge\b/, custom(1050, 675)],
  [/\blogo\b|\bapp\s*icon\b/, custom(500, 500)],
  [/\bsticker\b/, custom(800, 800)],
  [/\bwall\s*paper\b|\bdesktop\s*background\b/, custom(1920, 1080)],
  [/\bcertificate\b|\bdiploma\b/, custom(3300, 2550)],
  [/\binfographic\b/, custom(1080, 2700)],
  [/\bbrochure\b|\btri-?fold\b/, custom(2550, 3300)],
  [/\bletterhead\b/, custom(2550, 3300)],
  [/\bmenu\b/, custom(1275, 1650)],
  [/\bplanner\b|\bcalendar\b/, custom(2550, 3300)],
  [/\bbanner\b|\bheader\b|\bcover\s*(photo|image)?\b/, custom(1500, 500)],
  [/\b(greeting|birthday|thank\s*you)?\s*card\b|\binvitation\b|\binvite\b/, custom(1500, 1050)],
  // Real Canva Connect presets
  [/\bresume\b|\bcv\b|\bcurriculum\s*vitae\b/, preset('doc')],
  [/\bnewsletter\b|\bemail\b|\be-?mail\b/, preset('email')],
  [/\bwhite\s*board\b|\bbrainstorm\b|\bmind\s*map\b/, preset('whiteboard')],
  [/\bdocument\b|\bdoc\b|\bletter\b|\breport\b|\bessay\b|\barticle\b|\bproposal\b/, preset('doc')],
  [/\bpresentation\b|\bslides?\b|\bslide\s*show\b|\bpitch\s*deck\b|\bdeck\b/, preset('presentation')],
  // Weak/ambiguous bare-word fallbacks - only reached if nothing more specific
  // matched anywhere above (see note near the top of this list).
  [/\bstory\b/, custom(1080, 1920)],
  [/\bvideo\b/, custom(1920, 1080)],
  [/\bpin\b/, custom(1000, 1500)],
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

// ---------------------------------------------------------------------------
// Style detection: extract background/text/accent colors, font family, font
// size, alignment, vertical position, uppercase, and border directly from
// the "Describe the design" prompt (the SAME prompt deriveDesignType() reads
// for type/size). Pure regex/keyword matching, zero AI (see
// feedback_anthropic_key_tier_restriction) - anything not explicitly stated
// is left undefined so buildPptx() falls back to its existing defaults.
// ---------------------------------------------------------------------------
interface Style {
  bg?: string;
  text?: string;
  accent?: string;
  font?: string;
  sizePt?: number;
  sizeMult?: number;
  shape?: string;
  align?: 'left' | 'center' | 'right' | 'justify';
  vAlign?: 'top' | 'middle' | 'bottom';
  uppercase?: boolean;
  border?: { color?: string; thick: boolean };
}

// ---------------------------------------------------------------------------
// Decorative element (shape) detection. We can't reach into Canva's own free
// stock-graphics library through the public Connect API (no third-party
// search/insert endpoint exists for it - the same platform wall documented
// for Autofill), but pptxgenjs can draw real native shapes into the
// generated .pptx, which Canva's importer turns into a normal, fully
// editable shape element. This covers the common "add a circle/star/line
// accent" style requests without needing AI or any paid Canva tier.
//
// Bare shape words are NOT enough to trigger this - "add a shape/element/
// accent/icon/graphic/badge" qualifier is required, so ordinary body copy
// (e.g. "carry your cross", "rising star") is never misread as a shape request.
// ---------------------------------------------------------------------------
const SHAPE_WORDS: Record<string, string> = {
  circle: 'ellipse', circular: 'ellipse', oval: 'ellipse', ellipse: 'ellipse',
  star: 'star5', triangle: 'triangle', arrow: 'rightArrow',
  diamond: 'diamond', rhombus: 'diamond', heart: 'heart',
  hexagon: 'hexagon', pentagon: 'pentagon', cross: 'plus', plus: 'plus',
  line: 'line', bar: 'rect', square: 'rect', rectangle: 'rect', box: 'rect',
};
const SHAPE_NAMES = Object.keys(SHAPE_WORDS).sort((a, b) => b.length - a.length).join('|');
const ELEMENT_QUALIFIER = 'shape|element|accent|icon|graphic|badge';

function deriveShape(prompt: string): string | undefined {
  const p = prompt.toLowerCase();
  const m =
    new RegExp(`\\b(${SHAPE_NAMES})\\s+(?:${ELEMENT_QUALIFIER})\\b`, 'i').exec(p) ??
    new RegExp(`\\b(?:${ELEMENT_QUALIFIER})\\s+(?:of\\s+(?:a|an)\\s+)?(${SHAPE_NAMES})\\b`, 'i').exec(p) ??
    new RegExp(`\\badd\\s+(?:a|an)\\s+(${SHAPE_NAMES})\\b`, 'i').exec(p);
  if (!m) return undefined;
  const shape = SHAPE_WORDS[m[1].toLowerCase()];
  return shape === 'rect' && /\brounded\b/i.test(p) ? 'roundRect' : shape;
}

const COLOR_MAP: Record<string, string> = {
  black: '000000', white: 'FFFFFF', red: 'FF0000', blue: '0000FF', green: '008000',
  yellow: 'FFFF00', orange: 'FFA500', purple: '800080', pink: 'FFC0CB', cyan: '00FFFF',
  magenta: 'FF00FF', lime: '00FF00', gray: '808080', grey: '808080', navy: '000080',
  maroon: '800000', teal: '008080', gold: 'FFD700', silver: 'C0C0C0', brown: 'A52A2A',
  beige: 'F5F5DC', ivory: 'FFFFF0', coral: 'FF7F50', turquoise: '40E0D0', indigo: '4B0082',
  violet: 'EE82EE', crimson: 'DC143C', olive: '808000', mint: '98FF98', peach: 'FFDAB9',
  lavender: 'E6E6FA',
};
const COLOR_NAMES = Object.keys(COLOR_MAP).sort((a, b) => b.length - a.length).join('|');
// Both 3-digit shorthand (#0FF) and full 6-digit (#00FFFF) hex are accepted -
// ANY RGB value is allowed, not just the curated named-color list above.
const COLOR_TOKEN = `(#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?|${COLOR_NAMES})`;

function expandHex(hex: string): string {
  return hex.length === 3 ? hex.split('').map((ch) => ch + ch).join('') : hex;
}

function resolveColor(tok: string): string {
  return tok.startsWith('#') ? expandHex(tok.slice(1)).toUpperCase() : (COLOR_MAP[tok.toLowerCase()] ?? '000000');
}

// A hex token starts with "#", a non-word character, so a plain leading `\b`
// can never match when it's preceded by whitespace or start-of-string (both
// non-word, so there's no word/non-word transition for `\b` to find) - it
// would only match `TOKEN` patterns for named colors, silently never for hex.
// This lookbehind (not preceded by a word char or another `#`) works for both.
const NOT_MID_TOKEN = '(?<![\\w#])';

function matchColor(patterns: string[], text: string): string | undefined {
  for (const p of patterns) {
    const m = new RegExp(p, 'i').exec(text);
    if (m?.[1]) return resolveColor(m[1]);
  }
  return undefined;
}

// Curated list of common font names recognized even as a bare mention
// (no "font" keyword needed) - kept small and deliberate so ordinary words
// don't get misread as font requests. Any OTHER font name (including any of
// Canva's hundreds of free fonts) is still accepted via deriveExplicitFont()
// below, as long as the user says so with an explicit "font" phrase.
const FONT_NAMES = [
  'Comic Sans MS', 'Times New Roman', 'Trebuchet MS', 'Courier New', 'Open Sans',
  'Arial', 'Helvetica', 'Georgia', 'Verdana', 'Calibri', 'Impact', 'Montserrat',
  'Roboto', 'Poppins', 'Lato', 'Futura', 'Garamond', 'Tahoma', 'Fredoka',
].sort((a, b) => b.length - a.length);

const FONT_STOPWORDS = new Set(['a', 'an', 'the', 'using', 'use', 'in', 'with', 'on', 'set', 'make', 'font', 'fonts', 'family']);

function stripFontStopwords(phrase: string): string {
  const words = phrase.trim().split(/\s+/).filter(Boolean);
  while (words.length && FONT_STOPWORDS.has(words[0].toLowerCase())) words.shift();
  return words.join(' ');
}

// Lets the user request ANY font by name (Canva has hundreds; we can't
// hardcode them all) as long as they say so via an explicit "font" phrase -
// "font: Bebas Neue", "in Bebas Neue font", "using the Bebas Neue font".
// Falls through to the curated FONT_NAMES bare-word match below when absent.
function deriveExplicitFont(p: string): string | undefined {
  const quoted = /\bfont\s*(?:family)?\s*:?\s*"([^"]{1,40})"/i.exec(p);
  if (quoted?.[1]) return quoted[1].trim();

  const labeled = /\bfont\s*(?:family)?\s*:\s*([A-Za-z][A-Za-z0-9 '-]{0,39})/i.exec(p);
  if (labeled?.[1]) {
    const name = stripFontStopwords(labeled[1].split(/[,.\n]/)[0]);
    if (name) return name;
  }

  // "<Name> font" - walk backward WORD BY WORD from the word "font"/"fonts"
  // (not a single greedy regex - that can anchor at an earlier, unrelated
  // starting word and swallow it into the name). Stops at punctuation or at
  // a connector/filler word, so only the words truly adjacent to "font" -
  // including real multi-word names like "Times New Roman" - are captured.
  const tokens = p.split(/(\s+|[,.;!?])/).filter((t) => t.trim() !== '');
  const fontIdx = tokens.findIndex((t) => /^fonts?$/i.test(t));
  if (fontIdx > 0) {
    const words: string[] = [];
    for (let i = fontIdx - 1; i >= 0 && words.length < 4; i--) {
      const tok = tokens[i];
      if (!/^[A-Za-z][A-Za-z0-9'-]*$/.test(tok)) break;
      if (FONT_STOPWORDS.has(tok.toLowerCase())) break;
      words.unshift(tok);
    }
    const name = words.join(' ').trim();
    if (name) return name;
  }

  return undefined;
}

function luminance(hex: string): number {
  const r = parseInt(hex.slice(0, 2), 16) / 255;
  const g = parseInt(hex.slice(2, 4), 16) / 255;
  const b = parseInt(hex.slice(4, 6), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// Horizontal text alignment, read from an explicit natural-language phrase
// ("left aligned", "align right", "justify the text", "centered text").
function deriveAlign(p: string): Style['align'] {
  const m =
    /\b(left|right|center|centre|justify|justified)[\s-]*align(?:ed|ment)?\b/i.exec(p) ??
    /\balign(?:ed|ment)?\s*(?:to\s*the\s*)?(left|right|center|centre|justify|justified)\b/i.exec(p);
  if (!m) return undefined;
  const a = m[1].toLowerCase();
  if (a === 'centre') return 'center';
  if (a === 'justified') return 'justify';
  return a as Style['align'];
}

// Vertical placement of the title/body text within the slide. Requires the
// word "text"/"title"/"content"/"heading" right next to "top"/"bottom" (or an
// explicit "-aligned" form) so ordinary phrases like "a poster for the event
// at the bottom of the hill" don't misfire.
function deriveVAlign(p: string): Style['vAlign'] {
  if (/\b(?:text|title|content|heading)\s+(?:at|to)\s+the\s+bottom\b/i.test(p) || /\bbottom[\s-]align(?:ed)?\b/i.test(p)) return 'bottom';
  if (/\b(?:text|title|content|heading)\s+(?:at|to)\s+the\s+top\b/i.test(p) || /\btop[\s-]align(?:ed)?\b/i.test(p)) return 'top';
  if (/\bvertical(?:ly)?\s*(?:center|centre)(?:ed)?\b|\b(?:center|centre)(?:ed)?\s*vertical(?:ly)?\b|\bmiddle[\s-]align(?:ed)?\b/i.test(p)) return 'middle';
  return undefined;
}

// Optional full-slide outline/frame - "with a border", "framed", "add a
// frame" - color falls back to the text/accent color at build time if the
// user didn't also specify one. "thick"/"heavy"/"bold border" widens it.
function deriveBorder(p: string, resolvedColor?: string): Style['border'] {
  if (!/\bborder\b|\bframed?\b/i.test(p)) return undefined;
  const thick = /\bthick\b|\bheavy\b|\bbold\s+border\b|\bborder\s+.*\bthick\b/i.test(p);
  return { color: resolvedColor, thick };
}

function deriveStyle(prompt: string): Style {
  const p = prompt ?? '';
  const style: Style = {};

  style.bg = matchColor([
    `\\bbackground\\s*colou?r:?\\s*${COLOR_TOKEN}\\b`,
    `${NOT_MID_TOKEN}${COLOR_TOKEN}\\s*background\\b`,
    `\\bbackground\\s*${COLOR_TOKEN}\\b`,
  ], p);

  style.text = matchColor([
    `\\btext\\s*colou?r:?\\s*${COLOR_TOKEN}\\b`,
    `\\bfont\\s*colou?r:?\\s*${COLOR_TOKEN}\\b`,
    `${NOT_MID_TOKEN}${COLOR_TOKEN}\\s*text\\b`,
    `\\btext\\s*${COLOR_TOKEN}\\b`,
  ], p);

  style.accent = matchColor([
    `\\b(?:accent|element)s?\\s*colou?r:?\\s*${COLOR_TOKEN}\\b`,
    `${NOT_MID_TOKEN}${COLOR_TOKEN}\\s*(?:accent|element)s?\\b`,
  ], p);

  // Any hex code (e.g. #00F7FF) not already claimed by a qualified
  // background/text/element match defaults to the background - the most
  // common intent when a user just drops a brand hex into the prompt with
  // no "background"/"text" qualifier word at all.
  if (!style.bg) {
    const claimed = new Set([style.text, style.accent].filter(Boolean));
    const hexes = p.match(/#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?\b/g) ?? [];
    const free = hexes.map((h) => expandHex(h.slice(1)).toUpperCase()).find((h) => !claimed.has(h));
    if (free) style.bg = free;
  }

  const explicitFont = deriveExplicitFont(p);
  if (explicitFont) {
    style.font = explicitFont;
  } else {
    const fontRe = new RegExp(`\\b(${FONT_NAMES.join('|')})\\b`, 'i');
    const fontMatch = fontRe.exec(p);
    if (fontMatch) {
      const found = fontMatch[1].toLowerCase();
      style.font = FONT_NAMES.find((f) => f.toLowerCase() === found);
    }
  }

  style.shape = deriveShape(p);

  const explicitSize =
    /\b(\d{1,3})\s*(?:pt|px|point|points)\b/i.exec(p) ??
    /\bfont\s*size\s*(?:of\s*)?(\d{1,3})\b/i.exec(p) ??
    /\btext\s*size\s*(?:of\s*)?(\d{1,3})\b/i.exec(p) ??
    /\bsize\s*(?:of\s*)?(\d{1,3})\b/i.exec(p);
  if (explicitSize) {
    style.sizePt = clamp(parseInt(explicitSize[1], 10), 12, 120);
  } else if (/\b(large|big|huge|bigger)\b/i.test(p)) {
    style.sizeMult = 1.4;
  } else if (/\b(small|tiny|smaller)\b/i.test(p)) {
    style.sizeMult = 0.7;
  }

  style.align = deriveAlign(p);
  style.vAlign = deriveVAlign(p);
  style.uppercase = /\ball\s*caps\b|\ball[\s-]*capital(?:s|ized)?\b|\buppercase\b|\bcaps\s*lock\b/i.test(p);

  const borderColor = matchColor([
    `\\bborder\\s*colou?r:?\\s*${COLOR_TOKEN}\\b`,
    `${NOT_MID_TOKEN}${COLOR_TOKEN}\\s*border\\b`,
    `\\bborder\\s*${COLOR_TOKEN}\\b`,
  ], p);
  style.border = deriveBorder(p, borderColor);

  return style;
}

// ---------------------------------------------------------------------------
// Multi-slide content splitting. Users often paste multiple points (sermon
// outlines, event details, carousel copy) into the single "What should it
// say?" box. A blank line, or an explicit "---"/"***" separator line, between
// blocks now produces one slide per block (each block's first line becomes
// that slide's heading, same rule the single-slide path already used) instead
// of cramming everything into one overcrowded text box.
// ---------------------------------------------------------------------------
interface SlideContent {
  heading: string;
  body: string;
}

const MAX_SLIDES = 30;

function extractHeadlineBody(block: string): SlideContent {
  const lines = block.split(/\r?\n/);
  const firstIdx = lines.findIndex((l) => l.trim() !== '');
  if (firstIdx < 0) return { heading: '', body: '' };
  const heading = lines[firstIdx].trim();
  const body = lines.slice(firstIdx + 1).join('\n').trim();
  return { heading, body };
}

function splitIntoSlides(content: string): SlideContent[] {
  const normalized = content.replace(/\r\n/g, '\n');
  const withMarkers = normalized.replace(/^[ \t]*(-{3,}|\*{3,})[ \t]*$/gm, '\n\n');
  const blocks = withMarkers.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean).slice(0, MAX_SLIDES);
  if (blocks.length === 0) return [{ heading: '', body: '' }];
  return blocks.map(extractHeadlineBody);
}

// ---------------------------------------------------------------------------
// Bullet-list detection + shrink-to-fit sizing. Previously body font size was
// derived purely from the design's pixel dimensions and never checked against
// how much text actually had to fit, so longer user text could silently
// overflow its box. estimateLines/fitFontSize simulate greedy word-wrap at a
// given font size and shrink (in 2pt steps, down to a floor) until the
// content is estimated to fit the box height.
// ---------------------------------------------------------------------------
const BULLET_RE = /^\s*(?:[-*•]|\d+[.)])\s+/;

function isBulletList(lines: string[]): boolean {
  const nonEmpty = lines.filter((l) => l.trim() !== '');
  if (nonEmpty.length < 2) return false;
  const bulletCount = nonEmpty.filter((l) => BULLET_RE.test(l)).length;
  return bulletCount / nonEmpty.length >= 0.5;
}

// ---------------------------------------------------------------------------
// Table detection. Users often type schedules/price lists/rosters directly
// into the "What should it say?" box using a pipe delimiter ("9:00 AM |
// Sunday School"), the most natural plain-text way to express tabular data
// without any taught syntax. When at least 2 rows are pipe-delimited with a
// consistent column count, render a real, editable Canva table instead of
// wrapping it as one crowded paragraph. Falls through to normal paragraph/
// bullet rendering for anything that isn't clearly tabular - no false
// positives on ordinary prose that merely contains a stray "|".
// ---------------------------------------------------------------------------
function parseTableRows(bodyLines: string[]): string[][] | null {
  const rows = bodyLines.map((l) => l.trim()).filter((l) => l !== '' && !/^[\s|:-]+$/.test(l));
  if (rows.length < 2) return null;

  const withPipe = rows.filter((r) => r.includes('|'));
  if (withPipe.length / rows.length < 0.8) return null;

  const cleaned = rows.map((r) => {
    let cells = r.split('|').map((c) => c.trim());
    if (cells[0] === '') cells = cells.slice(1);
    if (cells.length && cells[cells.length - 1] === '') cells = cells.slice(0, -1);
    return cells;
  });

  const colCount = cleaned[0].length;
  if (colCount < 2) return null;
  if (!cleaned.every((r) => Math.abs(r.length - colCount) <= 1)) return null;

  return cleaned.map((r) => {
    const row = r.slice(0, colCount);
    while (row.length < colCount) row.push('');
    return row;
  });
}

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
// Build a .pptx (one or more slides) whose slide size equals the resolved
// pixel dimensions. Standard OOXML conversion is 1px @96dpi = 9525 EMU, which
// PptxGenJS expresses via a custom layout sized in inches (px / 96). When
// Canva imports this file, the resulting design inherits this exact size AND
// keeps each heading/body as real, editable text (rendered as a bulleted
// list, or a real table for pipe-delimited content). No themes/animations.
// ---------------------------------------------------------------------------
async function buildPptx(width: number, height: number, slides: SlideContent[], style: Style = {}): Promise<Uint8Array> {
  const wIn = width / 96;
  const hIn = height / 96;
  const pptx = new pptxgen();
  pptx.defineLayout({ name: 'NAVI', width: wIn, height: hIn });
  pptx.layout = 'NAVI';

  const isDarkBg = !!style.bg && luminance(style.bg) < 0.5;
  const textColor = style.text ?? (isDarkBg ? 'FFFFFF' : '000000');
  const fontFace = style.font ?? 'Arial';
  const titleAlign = style.align ?? 'center';
  const titleVAlign = style.vAlign ?? 'top';
  const bodyVAlign = style.vAlign ?? 'top';

  const base = Math.min(width, height);
  let baseTitleFont = clamp(Math.round(base / 22), 20, 80);
  let baseBodyFont = clamp(Math.round(base / 40), 12, 44);
  if (style.sizePt) {
    baseTitleFont = clamp(style.sizePt, 12, 120);
    baseBodyFont = clamp(Math.round(style.sizePt * 0.55), 12, 120);
  } else if (style.sizeMult) {
    baseTitleFont = clamp(Math.round(baseTitleFont * style.sizeMult), 12, 120);
    baseBodyFont = clamp(Math.round(baseBodyFont * style.sizeMult), 12, 120);
  }

  const marginX = wIn * 0.06;
  const contentW = wIn - marginX * 2;
  const titleBoxH = hIn * 0.24;
  const bodyBoxH = hIn * 0.54;

  for (const { heading, body } of slides) {
    const slide = pptx.addSlide();
    if (style.bg) slide.background = { color: style.bg };

    if (style.border) {
      const borderColor = style.border.color ?? textColor;
      const bw = style.border.thick ? 0.12 : 0.05;
      slide.addShape('rect' as any, {
        x: bw / 2, y: bw / 2, w: wIn - bw, h: hIn - bw,
        fill: { type: 'none' } as any,
        line: { color: borderColor, width: style.border.thick ? 6 : 2 },
      });
    }

    if (style.shape || style.accent) {
      const shapeColor = style.accent ?? textColor;
      if (!style.shape || style.shape === 'rect') {
        // Default/plain-rect case: thin full-width accent bar near the top
        // (~5% of slide height) - preserves the original accent-color behaviour.
        slide.addShape('rect' as any, {
          x: 0, y: 0, w: wIn, h: hIn * 0.05,
          fill: { color: shapeColor }, line: { color: shapeColor },
        });
      } else {
        // A named decorative element (circle, star, arrow, etc.): a modestly
        // sized shape in the top-right corner, real and fully editable once
        // Canva imports it.
        const size = Math.min(wIn, hIn) * 0.16;
        slide.addShape(style.shape as any, {
          x: wIn - size - marginX, y: hIn * 0.05, w: size, h: size,
          fill: { color: shapeColor }, line: { color: shapeColor },
        });
      }
    }

    if (heading) {
      const headingText = style.uppercase ? heading.toUpperCase() : heading;
      // Only auto-shrink when the user didn't request an explicit size -
      // an explicit request should be honored as-is, not overridden.
      const titleFont = style.sizePt ? baseTitleFont : fitFontSize([headingText], contentW, titleBoxH, baseTitleFont, 14);
      slide.addText(headingText, {
        x: marginX, y: hIn * 0.08, w: contentW, h: titleBoxH,
        fontSize: titleFont, bold: true, align: titleAlign, valign: titleVAlign,
        fontFace, color: textColor, wrap: true,
      });
    }
    if (body) {
      const bodyLines = body.split(/\r?\n/);
      const tableRows = parseTableRows(bodyLines);

      if (tableRows) {
        const tableFont = clamp(baseBodyFont, 10, 32);
        const tRows = tableRows.map((r, i) => r.map((cell) => ({
          text: style.uppercase ? cell.toUpperCase() : cell,
          options: { bold: i === 0, fontFace, color: textColor, fontSize: tableFont, valign: 'middle', align: 'left' },
        })));
        slide.addTable(tRows as any, {
          x: marginX, y: hIn * 0.38, w: contentW, h: bodyBoxH,
          border: { type: 'solid', color: textColor, pt: 1 } as any,
          autoPage: false,
        });
      } else {
        const bulleted = isBulletList(bodyLines);
        const cleanLines = (bulleted ? bodyLines.map((line) => line.replace(BULLET_RE, '')) : bodyLines)
          .map((line) => (style.uppercase ? line.toUpperCase() : line));
        const bodyFont = style.sizePt ? baseBodyFont : fitFontSize(cleanLines, contentW - (bulleted ? 0.3 : 0), bodyBoxH, baseBodyFont, 10);
        // Split into paragraph runs so newlines render as real line breaks
        // (and, when the text looks like a list, as real Canva bullet points).
        const runs = cleanLines.map((line) => ({
          text: line,
          options: bulleted ? { breakLine: true, bullet: true } : { breakLine: true },
        }));
        slide.addText(runs as unknown as string, {
          x: marginX, y: hIn * 0.38, w: contentW, h: bodyBoxH,
          fontSize: bodyFont, align: style.align ?? (bulleted ? 'left' : (heading ? 'left' : 'center')), valign: bodyVAlign,
          fontFace, color: textColor, wrap: true,
        });
      }
    }
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

      // Optional content: first non-blank line of each block is that block's
      // headline, the rest is body text. Pure string splitting, no AI. Blank
      // lines or "---"/"***" separators split the content into multiple
      // slides (e.g. a list of event details or sermon points becomes one
      // slide per point instead of one crowded text box). Drives the import path.
      const contentClean = (content ?? '').trim();
      const hasContent = contentClean.length > 0;
      const slides: SlideContent[] = hasContent ? splitIntoSlides(contentClean) : [{ heading: '', body: '' }];

      const title = deriveTitle(cleanPrompt);
      const designType = deriveDesignType(cleanPrompt);
      const contentToStore = hasContent ? contentClean : null;

      // Style (colors/font/size/alignment/border/etc) is read from the SAME
      // "Describe the design" prompt that already drives type/size detection
      // above - no new field.
      const style = deriveStyle(cleanPrompt);
      const hasStyle = !!(
        style.bg || style.text || style.accent || style.font || style.sizePt || style.sizeMult ||
        style.shape || style.align || style.vAlign || style.uppercase || style.border
      );

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
      // CONTENT/STYLE PATH: generate a sized .pptx with real text and/or the
      // detected colors/font/size/alignment/border, import it into Canva as
      // a fully-editable design of the exact detected dimensions. Runs
      // whenever there is user text OR any style was detected in the prompt
      // (a "black background" request with no body text still needs the
      // import path - a blank POST /v1/designs call has no way to set colors).
      // -------------------------------------------------------------------
      if (hasContent || hasStyle) {
        const { width, height } = designTypeToDims(designType);

        let bytes: Uint8Array;
        try {
          bytes = await buildPptx(width, height, slides, style);
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
      // NO-CONTENT-AND-NO-STYLE PATH (unchanged): create a blank design via
      // POST /v1/designs when the prompt only specified type/size.
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
