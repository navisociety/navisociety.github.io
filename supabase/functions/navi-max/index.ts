// navi-max — Claude Sonnet for Max subscribers
// verify_jwt: false. Frontend sends NO Authorization header.

const ALLOWED_ORIGINS = [
  "https://navisociety.github.io",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
];

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey",
    "Content-Type": "application/json",
  };
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

const MODEL = "claude-sonnet-4-5-20250929";
const LIMIT_USD = 10.0;
const SYSTEM_PROMPT =
  "You are NAVI, an AI assistant built by NAVIsociety. Be helpful, concise, and thoughtful. Never mention Claude, Anthropic, or any underlying AI provider.";
const NAVI_FALLBACK =
  "I'm having a little trouble thinking right now. Give me a moment and try again.";

function monthKey(): string {
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = String(now.getUTCMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

async function sb(path: string, init: RequestInit): Promise<Response> {
  return await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
  });
}

async function searchDuckDuckGo(query: string): Promise<{ text: string; url: string }> {
  try {
    const res = await fetch(
      `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`,
      { signal: AbortSignal.timeout(3000) }
    );
    if (!res.ok) return { text: '', url: '' };
    const data = await res.json();
    if (data.Answer) return { text: String(data.Answer).slice(0, 300), url: data.AnswerType || '' };
    if (data.AbstractText) return { text: String(data.AbstractText).slice(0, 300), url: data.AbstractURL || '' };
    if (data.RelatedTopics?.[0]?.Text) return { text: String(data.RelatedTopics[0].Text).slice(0, 200), url: data.RelatedTopics[0].FirstURL || '' };
    return { text: '', url: '' };
  } catch {
    return { text: '', url: '' };
  }
}

function needsSearch(message: string): boolean {
  const t = message.toLowerCase();
  return /\b(who is|what is|when did|where is|how many|latest|news|current|today|price of|define|meaning of|capital of|population|weather in)\b/.test(t)
    || (t.includes('?') && t.split(' ').length < 10);
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers });
  }

  try {
    const body = await req.json();
    const message: string = body.message || "";
    const history: Array<{ role: string; content: string }> = Array.isArray(body.history) ? body.history : [];
    const userEmail: string = body.user_email || "";

    if (!userEmail) {
      return new Response(JSON.stringify({ code: "no_subscription" }), { status: 200, headers });
    }

    // 1. Subscription check — tier must be exactly max
    const subRes = await sb(
      `navi_subscriptions?email=eq.${encodeURIComponent(userEmail)}&status=eq.active&tier=eq.max&select=tier&limit=1`,
      { method: "GET" }
    );
    const subs = await subRes.json();
    if (!Array.isArray(subs) || subs.length === 0) {
      return new Response(JSON.stringify({ code: "no_subscription" }), { status: 200, headers });
    }

    // 2. Usage check
    const mk = monthKey();
    const usageRes = await sb(
      `navi_usage?email=eq.${encodeURIComponent(userEmail)}&month_key=eq.${mk}&select=usd_spent&limit=1`,
      { method: "GET" }
    );
    const usageRows = await usageRes.json();
    const spentSoFar = Array.isArray(usageRows) && usageRows.length > 0 ? Number(usageRows[0].usd_spent) || 0 : 0;
    if (spentSoFar >= LIMIT_USD) {
      return new Response(JSON.stringify({ code: "limit_reached" }), { status: 200, headers });
    }

    // 3. Optional web search grounding
    let searchContext = '';
    if (needsSearch(message)) {
      const { text, url } = await searchDuckDuckGo(message);
      if (text) searchContext = `\nSEARCH RESULT FOR CONTEXT:\n${text}${url ? ' — Source: ' + url : ''}\n\nUse this as factual grounding where relevant. Do not fabricate beyond it.`;
    }

    // 4. Anthropic call
    const recent = history.slice(-10).map((m) => ({
      role: m.role === "assistant" ? "assistant" : "user",
      content: String(m.content || ""),
    }));
    const messages = [...recent, { role: "user", content: message }];

    const aiRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        system: SYSTEM_PROMPT + searchContext,
        messages,
      }),
    });

    if (!aiRes.ok) {
      return new Response(JSON.stringify({ response: NAVI_FALLBACK }), { status: 200, headers });
    }

    const aiData = await aiRes.json();
    const responseText: string =
      Array.isArray(aiData.content) && aiData.content[0]?.text ? aiData.content[0].text : NAVI_FALLBACK;

    const inputTokens = aiData.usage?.input_tokens || 0;
    const outputTokens = aiData.usage?.output_tokens || 0;
    // Sonnet pricing
    const cost = (inputTokens * 3.0 + outputTokens * 15.0) / 1_000_000;

    // 4. Atomic usage increment via RPC (avoids read-then-write race)
    let newTotal = spentSoFar + cost;
    try {
      const rpcRes = await fetch(`${SUPABASE_URL}/rest/v1/rpc/navi_add_usage`, {
        method: "POST",
        headers: {
          apikey: SERVICE_KEY,
          Authorization: `Bearer ${SERVICE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ p_email: userEmail, p_tier: "max", p_month_key: mk, p_cost: cost }),
      });
      const rpcVal = await rpcRes.json();
      if (typeof rpcVal === "number") newTotal = rpcVal;
    } catch (_e) { /* keep estimate */ }

    return new Response(
      JSON.stringify({
        response: responseText,
        usage: { spent_usd: newTotal, limit_usd: LIMIT_USD, month_key: mk },
      }),
      { status: 200, headers }
    );
  } catch (_e) {
    return new Response(JSON.stringify({ response: NAVI_FALLBACK }), { status: 200, headers });
  }
});
