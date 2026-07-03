// navi-choice: Pros/cons decision-helper tool. Content-aware deterministic
// scoring (theme keyword weighing) plus insights from the NAVI LLM via the
// navi-chat edge function. No Anthropic calls (this is a free-tier NAVI feature).
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

const COLS = 'id,user_email,question,pros,cons,verdict,answer,created_at';
const MAX_CHOICES = 200;
const MIN_ANSWER_WORDS = 200;

export function parseList(raw: string): string[] {
  return raw.split('\n').map(s => s.trim()).filter(Boolean);
}

export function wordCount(s: string): number {
  return s.trim().split(/\s+/).filter(Boolean).length;
}

// Content-aware weighing: each pro/con starts at weight 1 and gains weight when
// it touches a life theme that genuinely matters more than a neutral bullet
// point, when it is written with emotional intensity, or when it is a
// thought-out sentence rather than a two-word note. All deterministic keyword
// matching — no AI calls.
interface Theme {
  name: string;
  boost: number;
  pattern: RegExp;
  why: string;
}

const THEMES: Theme[] = [
  {
    name: 'health & peace of mind',
    boost: 2,
    pattern: /\b(health\w*|sick\w*|illness|doctor|sleep\w*|stress\w*|burnout|tired|exhaust\w*|anxiety|anxious|depress\w*|unsafe|safety|danger\w*|injur\w*|pain\w*|peace|rest)\b/i,
    why: 'that touches your health and peace of mind, and nothing on the other side of a list buys those back once they are spent',
  },
  {
    name: 'people & relationships',
    boost: 2,
    pattern: /\b(family|wife|husband|kids?|child\w*|marriage|marry\w*|friends?|friendship\w*|relationship\w*|parents?|mother|father|mom|dad|lonely|lonel\w*|community|together)\b/i,
    why: 'that is about the people in your life, and they will still be there long after the practical details of this decision have faded',
  },
  {
    name: 'faith & purpose',
    boost: 2,
    pattern: /\b(god|faith\w*|pray\w*|calling|purpose|ministry|church\w*|spirit\w*|mission|vision|kingdom)\b/i,
    why: 'that touches your calling and purpose, which carries more weight than any list of practical conveniences ever could',
  },
  {
    name: 'risk & reversibility',
    boost: 1.5,
    pattern: /\b(risk\w*|permanent\w*|irreversible|lose|losing|lost|quit\w*|fail\w*|regret\w*|stuck|trapped|forever)\b/i,
    why: 'anything that is hard to reverse deserves extra caution, because a mistake there cannot simply be undone next week',
  },
  {
    name: 'money & security',
    boost: 1.5,
    pattern: /\b(money|pay\w*|salar\w*|income|cost\w*|expens\w*|cheap\w*|debt\w*|afford\w*|rent|bills?|price\w*|financ\w*|profit\w*|savings?|security|stable|stability)\b/i,
    why: 'money is a real factor and right to count, though most money problems can be worked around over time in a way deeper costs cannot',
  },
  {
    name: 'growth & opportunity',
    boost: 1.5,
    pattern: /\b(grow\w*|learn\w*|opportunit\w*|career\w*|skills?|experience\w*|future|dreams?|potential|promot\w*|improve\w*)\b/i,
    why: 'room to grow compounds quietly — its true value shows up months and years from now, not on day one',
  },
  {
    name: 'time & energy',
    boost: 1,
    pattern: /\b(time|commute\w*|hours?|schedule\w*|busy|travel\w*|distance|far)\b/i,
    why: 'your time and energy are the one budget that never refills, so a point about them is never a small point',
  },
];

const DEFAULT_WHY =
  'the fact that you took the trouble to write it down means it already carries real weight in your own mind';

const INTENSITY = /\b(love\w*|hate\w*|terrified|scared|afraid|huge|major|massive|always|never|really|desperately|amazing|awful|badly)\b/i;

export interface WeighedItem {
  text: string;
  weight: number;
  theme: Theme | null;
}

export function weighItem(text: string): WeighedItem {
  let weight = 1;
  let theme: Theme | null = null;
  for (const t of THEMES) {
    if (t.pattern.test(text)) {
      weight += t.boost;
      if (!theme || t.boost > theme.boost) theme = t;
    }
  }
  if (INTENSITY.test(text)) weight += 0.5;
  if (wordCount(text) >= 6) weight += 0.5;
  return { text, weight, theme };
}

export function weighList(items: string[]): number {
  return items.reduce((sum, item) => sum + weighItem(item).weight, 0);
}

export function scoreVerdict(prosWeight: number, consWeight: number): string {
  const diff = prosWeight - consWeight;
  if (diff >= 3) return 'Go for it';
  if (diff >= 0.75) return 'Lean toward yes';
  if (diff > -0.75) return "It's a genuine toss-up";
  if (diff > -3) return 'Lean toward no';
  return "Don't do it";
}

// ── NAVI LLM insights ─────────────────────────────────────────────────────────
// Ask NAVI's own model (the navi-chat engine: knowledge nodes + fuzzy
// retrieval) for a thought on the question and on the heaviest pro/con.
// navi-chat is NAVI's own LLM — no Anthropic involved, so this stays
// free-tier-safe. Generic fallbacks and counter-questions are filtered out;
// when NAVI has nothing sharp, the deterministic answer stands on its own.
const NAVI_CHAT_URL = `${Deno.env.get('SUPABASE_URL')}/functions/v1/navi-chat`;

const NAVI_FALLBACK_MARKERS = [
  "I don't have a sharp answer",
  "That's outside what I know",
  "I'm not sure I have that one",
  'Give me the context',
  'Tell me more',
  'tell me more',
  'Say more about that',
  'What made you bring that up',
  'Go deeper on that',
  'Where does that lead',
  'I want to answer that properly',
  "I don't have that fully mapped",
  'at the edge of what I know',
  "I'm still building in that area",
];

// Turn a navi-chat reply into an insight usable inside a written verdict:
// drop fallback replies entirely, strip NAVI's trailing conversational
// questions (this answer is a document, not a chat turn), and keep at most
// three substantive sentences. Returns '' when nothing usable remains.
export function usableInsight(reply: string): string {
  const trimmed = (reply ?? '').trim();
  if (!trimmed) return '';
  if (NAVI_FALLBACK_MARKERS.some(s => trimmed.includes(s))) return '';
  const sentences = trimmed.split(/(?<=[.!?])\s+/);
  while (sentences.length && sentences[sentences.length - 1].trim().endsWith('?')) {
    sentences.pop();
  }
  const insight = sentences.slice(0, 3).join(' ').trim();
  return insight.length >= 40 ? insight : '';
}

async function askNavi(message: string): Promise<string> {
  try {
    const res = await fetch(NAVI_CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, history: [] }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return '';
    const data = await res.json();
    const reply = typeof data?.response === 'string' ? data.response : '';
    return usableInsight(reply);
  } catch {
    return '';
  }
}

export interface NaviInsights {
  question?: string;
  crux?: string;
  cruxText?: string;
}

// Fixed decision-making guidance, appended one sentence at a time until the
// answer clears MIN_ANSWER_WORDS regardless of how little pros/cons text a
// user actually typed in.
const FILLER = [
  'Think about how reversible this decision actually is: if you can undo it easily and cheaply, it is usually safer to lean toward action rather than staying stuck in analysis.',
  'Consider the timing too — a good choice made too late can matter less than a decent choice made while it still counts, so do not let this drag on indefinitely.',
  'It also helps to ask whether this choice lines up with what you actually value, not just what feels comfortable in the moment, since short-term comfort and long-term alignment are not always the same thing.',
  'Write down the one thing that would have to change for the opposite answer to become true — that single condition is usually the real hinge point of the whole decision.',
  'Notice how you feel reading the verdict above: if there is instant relief, that is usually a sign your gut already agreed before your head finished doing the math.',
];

export function buildAnswer(
  question: string,
  prosList: string[],
  consList: string[],
  insights: NaviInsights = {},
): string {
  const pros = prosList.map(weighItem);
  const cons = consList.map(weighItem);
  const prosWeight = pros.reduce((s, p) => s + p.weight, 0);
  const consWeight = cons.reduce((s, c) => s + c.weight, 0);
  const verdict = scoreVerdict(prosWeight, consWeight);

  const heaviest = (items: WeighedItem[]) =>
    items.reduce<WeighedItem | null>((best, i) => (!best || i.weight > best.weight ? i : best), null);
  const topPro = heaviest(pros);
  const topCon = heaviest(cons);

  const opening = `Best choice: ${verdict}.\n\n`;

  let body = `You're weighing this: ${question}. `;
  if (topPro) {
    body += `Looking at what you actually wrote — not just how much of it — the strongest thing in favour is "${topPro.text}": ${topPro.theme ? topPro.theme.why : DEFAULT_WHY}. `;
    const rest = pros.filter(p => p !== topPro);
    if (rest.length) body += `Alongside it you also noted ${rest.map(p => `"${p.text}"`).join(', ')}. `;
  } else {
    body += `You didn't write down a single specific upside, which is itself telling — if the good side were obvious, it would have been easy to name. `;
  }
  if (topCon) {
    body += `On the other side, the concern that carries the most real weight is "${topCon.text}": ${topCon.theme ? topCon.theme.why : DEFAULT_WHY}. `;
    const rest = cons.filter(c => c !== topCon);
    if (rest.length) body += `You also raised ${rest.map(c => `"${c.text}"`).join(', ')}. `;
  } else {
    body += `You didn't raise a single concrete downside, and when nothing specific stands in the way, hesitation is usually about the newness of the thing rather than a real cost. `;
  }

  const diff = prosWeight - consWeight;
  const balance = Math.abs(diff) < 0.75
    ? 'comes out almost perfectly even'
    : diff > 0 ? 'tips toward going ahead' : 'tips toward holding back';
  body += `Weighing the substance of each point rather than just counting them, what you wrote ${balance}, and that is why the verdict reads the way it does.`;

  const countDiff = prosList.length - consList.length;
  if ((countDiff > 0 && diff <= -0.75) || (countDiff < 0 && diff >= 0.75)) {
    body += ` Notice something important: by raw count your list leans the other way, but a pros-and-cons list isn't a vote — what you wrote on the ${diff > 0 ? 'pro' : 'con'} side simply matters more than the number of entries opposite it.`;
  }

  const insightParts: string[] = [];
  if (insights.question) {
    insightParts.push(`Here's my own thought on the heart of your question: ${insights.question}`);
  }
  if (insights.crux && insights.cruxText) {
    insightParts.push(`And on "${insights.cruxText}" specifically: ${insights.crux}`);
  }
  const insightBlock = insightParts.length ? `\n\n${insightParts.join(' ')}` : '';

  const reasoningBase =
    `When a decision is close, the number of reasons on each side is a decent starting signal but not the whole story — one deeply important pro or con can outweigh three minor ones, so it is worth re-reading your own list and asking which single item matters most, rather than just counting entries.`;

  const closing = `\n\nSo, to answer clearly: the best choice is ${verdict}.`;

  let fillerUsed = 0;
  let answer = `${opening}${body}${insightBlock}\n\n${reasoningBase}${closing}`;
  while (wordCount(answer) < MIN_ANSWER_WORDS) {
    fillerUsed++;
    const reasoning = `${reasoningBase} ${FILLER.slice(0, fillerUsed).join(' ')}`;
    answer = `${opening}${body}${insightBlock}\n\n${reasoning}${closing}`;
  }

  return answer;
}

serve(async (req) => {
  const origin = req.headers.get('Origin');
  const c = cors(origin);
  if (req.method === 'OPTIONS') return new Response(null, { headers: c });

  try {
    const body = await req.json();
    const { action, email, id } = body;

    if (!email) return Response.json({ error: 'email required' }, { status: 400, headers: c });

    if (action === 'list-choices') {
      const { data, error } = await sb.from('navi_choices').select(COLS).eq('user_email', email).order('created_at', { ascending: false });
      if (error) throw new Error(error.message);
      return Response.json({ choices: data ?? [] }, { headers: c });
    }

    if (action === 'add-choice') {
      const question = (body.question ?? '').trim();
      if (!question) return Response.json({ error: 'question required' }, { status: 400, headers: c });

      const { count } = await sb.from('navi_choices').select('id', { count: 'exact', head: true }).eq('user_email', email);
      if ((count ?? 0) >= MAX_CHOICES) return Response.json({ error: 'You have too many saved choices (max 200). Delete some first.' }, { status: 400, headers: c });

      const prosRaw = String(body.pros ?? '');
      const consRaw = String(body.cons ?? '');
      const prosList = parseList(prosRaw);
      const consList = parseList(consRaw);
      const verdict = scoreVerdict(weighList(prosList), weighList(consList));

      // Ask the NAVI LLM (navi-chat) about the question itself and about the
      // single heaviest pro/con — the crux of the decision. Both calls are
      // best-effort: if navi-chat is slow or has nothing sharp, the
      // deterministic answer stands on its own.
      const crux = [...prosList, ...consList]
        .map(weighItem)
        .reduce<WeighedItem | null>((best, i) => (!best || i.weight > best.weight ? i : best), null);
      const [qInsight, cruxInsight] = await Promise.all([
        askNavi(question),
        crux ? askNavi(crux.text) : Promise.resolve(''),
      ]);
      // The question and the crux can hit the same knowledge node — don't say
      // the same thing twice.
      const cruxFresh = cruxInsight && cruxInsight !== qInsight ? cruxInsight : '';
      const answer = buildAnswer(question, prosList, consList, {
        question: qInsight || undefined,
        crux: cruxFresh || undefined,
        cruxText: crux?.text,
      });

      const { data, error } = await sb.from('navi_choices').insert({
        user_email: email, question, pros: prosRaw, cons: consRaw, verdict, answer,
      }).select(COLS).single();
      if (error) throw new Error(error.message);
      return Response.json({ choice: data }, { headers: c });
    }

    if (action === 'delete-choice') {
      if (!id) return Response.json({ error: 'id required' }, { status: 400, headers: c });
      const { error } = await sb.from('navi_choices').delete().eq('id', id).eq('user_email', email);
      if (error) throw new Error(error.message);
      return Response.json({ ok: true }, { headers: c });
    }

    return Response.json({ error: 'unknown action' }, { status: 400, headers: c });
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500, headers: cors(req.headers.get('Origin')) });
  }
});
