// navi-chats — Save and load chat history
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
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey",
    "Content-Type": "application/json",
  };
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

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

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers });
  }

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const email = url.searchParams.get("email") || "";
      if (!email) {
        return new Response(JSON.stringify([]), { status: 200, headers });
      }
      const res = await sb(
        `navi_conversations?email=eq.${encodeURIComponent(email)}&select=id,role,content,created_at,tier&order=created_at.asc&limit=200`,
        { method: "GET" }
      );
      const rows = await res.json();
      return new Response(JSON.stringify(Array.isArray(rows) ? rows : []), { status: 200, headers });
    }

    if (req.method === "POST") {
      const body = await req.json();
      const email: string = body.email || "";
      const role: string = body.role || "";
      const content: string = body.content || "";
      const tier: string = body.tier || "free";

      if (!email || !role || !content) {
        return new Response(JSON.stringify({ error: "missing fields" }), { status: 200, headers });
      }

      await sb(`navi_conversations`, {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ email, role, content, tier }),
      });

      return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: "method not allowed" }), { status: 200, headers });
  } catch (_e) {
    return new Response(JSON.stringify({ error: "internal error" }), { status: 200, headers });
  }
});
