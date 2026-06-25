// navi-chats — Chat sessions: list, create, save message, rename, delete
// verify_jwt: false

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
    "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey",
    "Content-Type": "application/json",
  };
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

async function sb(path: string, init: RequestInit): Promise<any> {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...(init.headers as Record<string, string> || {}),
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) return null;
  const text = await res.text();
  if (!text) return null;
  try { return JSON.parse(text); } catch { return null; }
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);
  const url = new URL(req.url);

  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers });

  try {

    // ── GET ──────────────────────────────────────────────────────────────
    if (req.method === "GET") {
      const email = url.searchParams.get("email") || "";
      const sessionId = url.searchParams.get("session_id") || "";
      if (!email) return new Response(JSON.stringify([]), { status: 200, headers });

      if (sessionId) {
        // Return messages for a specific session
        const rows = await sb(
          `navi_conversations?session_id=eq.${sessionId}&email=eq.${encodeURIComponent(email)}&select=id,role,content,created_at,tier&order=created_at.asc&limit=500`,
          { method: "GET" }
        );
        return new Response(JSON.stringify(rows ?? []), { status: 200, headers });
      }

      // Return session list with last message preview
      const sessions = await sb(
        `navi_chat_sessions?email=eq.${encodeURIComponent(email)}&select=id,title,created_at,updated_at&order=updated_at.desc&limit=100`,
        { method: "GET" }
      );
      if (!Array.isArray(sessions)) return new Response(JSON.stringify([]), { status: 200, headers });

      // Attach last message preview to each session
      const enriched = await Promise.all(sessions.map(async (s: any) => {
        const msgs = await sb(
          `navi_conversations?session_id=eq.${s.id}&select=content,role&order=created_at.desc&limit=1`,
          { method: "GET" }
        );
        const last = Array.isArray(msgs) && msgs.length > 0 ? msgs[0].content : "";
        return { ...s, last_message: last };
      }));

      return new Response(JSON.stringify(enriched), { status: 200, headers });
    }

    // ── DELETE ───────────────────────────────────────────────────────────
    if (req.method === "DELETE") {
      const sessionId = url.searchParams.get("session_id") || "";
      const email = url.searchParams.get("email") || "";
      if (!sessionId || !email) {
        return new Response(JSON.stringify({ error: "missing fields" }), { status: 200, headers });
      }
      // CASCADE on session_id handles deleting conversations automatically
      await sb(
        `navi_chat_sessions?id=eq.${sessionId}&email=eq.${encodeURIComponent(email)}`,
        { method: "DELETE", headers: { Prefer: "return=minimal" } }
      );
      return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    }

    // ── POST ─────────────────────────────────────────────────────────────
    if (req.method === "POST") {
      const body = await req.json();
      const action: string = body.action || "";

      // Create a new session
      if (action === "create") {
        const email: string = body.email || "";
        if (!email) return new Response(JSON.stringify({ error: "missing email" }), { status: 200, headers });
        const result = await sb(`navi_chat_sessions`, {
          method: "POST",
          headers: { Prefer: "return=representation" },
          body: JSON.stringify({ email, title: "New Chat" }),
        });
        const session = Array.isArray(result) ? result[0] : result;
        return new Response(JSON.stringify({ session_id: session?.id ?? null }), { status: 200, headers });
      }

      // Save a message to a session
      if (action === "message") {
        const { session_id, email, role, content, tier = "free" } = body;
        if (!session_id || !email || !role || !content) {
          return new Response(JSON.stringify({ error: "missing fields" }), { status: 200, headers });
        }
        await sb(`navi_conversations`, {
          method: "POST",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ session_id, email, role, content, tier }),
        });
        // Update session updated_at
        await sb(`navi_chat_sessions?id=eq.${session_id}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ updated_at: new Date().toISOString() }),
        });
        return new Response(JSON.stringify({ success: true }), { status: 200, headers });
      }

      // Rename a session
      if (action === "rename") {
        const { session_id, email, title } = body;
        if (!session_id || !email || !title) {
          return new Response(JSON.stringify({ error: "missing fields" }), { status: 200, headers });
        }
        await sb(`navi_chat_sessions?id=eq.${session_id}&email=eq.${encodeURIComponent(email)}`, {
          method: "PATCH",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ title }),
        });
        return new Response(JSON.stringify({ success: true }), { status: 200, headers });
      }

      // Legacy: old POST {email, role, content, tier} without action — save without session
      const { email, role, content, tier = "free" } = body;
      if (email && role && content) {
        await sb(`navi_conversations`, {
          method: "POST",
          headers: { Prefer: "return=minimal" },
          body: JSON.stringify({ email, role, content, tier }),
        });
        return new Response(JSON.stringify({ success: true }), { status: 200, headers });
      }

      return new Response(JSON.stringify({ error: "unknown action" }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: "method not allowed" }), { status: 200, headers });

  } catch (_e) {
    return new Response(JSON.stringify({ error: "internal error" }), { status: 200, headers });
  }
});
