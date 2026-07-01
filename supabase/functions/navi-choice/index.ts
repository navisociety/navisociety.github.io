// navi-choice: Pros/cons decision-helper tool. Deterministic scoring + template
// answer generation only — no AI/Anthropic calls (this is a free-tier NAVI feature).
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

export function scoreVerdict(prosCount: number, consCount: number): string {
  const diff = prosCount - consCount;
  if (diff >= 3) return 'Go for it';
  if (diff >= 1) return 'Lean toward yes';
  if (diff === 0) return "It's a genuine toss-up";
  if (diff >= -2) return 'Lean toward no';
  return "Don't do it";
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

export function buildAnswer(question: string, prosList: string[], consList: string[]): string {
  const verdict = scoreVerdict(prosList.length, consList.length);
  const prosPhrase = prosList.length
    ? prosList.map(p => `"${p}"`).join(', ')
    : 'nothing specific written down as an upside';
  const consPhrase = consList.length
    ? consList.map(c => `"${c}"`).join(', ')
    : 'nothing specific written down as a downside';
  const balance = prosList.length === consList.length
    ? 'is evenly split'
    : prosList.length > consList.length
      ? 'tips toward the reasons to go ahead'
      : 'tips toward the reasons to hold back';

  const opening = `Best choice: ${verdict}.\n\n`;

  const body =
    `You're weighing this: ${question}. On the pro side, you listed ${prosList.length} point${prosList.length === 1 ? '' : 's'} — ${prosPhrase}. ` +
    `On the con side, you listed ${consList.length} point${consList.length === 1 ? '' : 's'} — ${consPhrase}. ` +
    `Comparing the two lists side by side, the balance of what you wrote ${balance}, which is why the verdict above leans the way it does. ` +
    `A pros-and-cons list is really just a way of making your own reasoning visible to yourself — the goal is not to get a "perfect" score, it is to notice which side you already believe more strongly once it is laid out plainly in front of you.`;

  const reasoningBase =
    `When a decision is close, the number of reasons on each side is a decent starting signal but not the whole story — one deeply important pro or con can outweigh three minor ones, so it is worth re-reading your own list and asking which single item matters most, rather than just counting entries.`;

  const closing = `\n\nSo, to answer clearly: the best choice is ${verdict}.`;

  let fillerUsed = 0;
  let answer = `${opening}${body}\n\n${reasoningBase}${closing}`;
  while (wordCount(answer) < MIN_ANSWER_WORDS) {
    fillerUsed++;
    const reasoning = `${reasoningBase} ${FILLER.slice(0, fillerUsed).join(' ')}`;
    answer = `${opening}${body}\n\n${reasoning}${closing}`;
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
      const verdict = scoreVerdict(prosList.length, consList.length);
      const answer = buildAnswer(question, prosList, consList);

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
