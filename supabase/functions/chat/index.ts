// NAVI chat Edge Function — Supabase (Deno).
//
// Receives { message, history } from the authenticated client, verifies the
// caller is prophetdian@gmail.com, calls the Anthropic Messages API with Claude
// Haiku 4.5, and returns { reply }. The Anthropic key is read from the
// ANTHROPIC_API_KEY secret (never shipped to the client). If the key is missing
// the function returns a graceful message instead of crashing.
//
// Deploy:
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
//   supabase functions deploy chat
//
// SUPABASE_URL and SUPABASE_ANON_KEY are injected automatically by the platform.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const ALLOWED_EMAIL = "prophetdian@gmail.com";
const ANTHROPIC_MODEL = "claude-haiku-4-5-20251001";
const ANTHROPIC_VERSION = "2023-06-01";
const SYSTEM_PROMPT =
  "You are NAVI, an intelligent AI assistant for NAVIsociety, created by " +
  "Prophet Dian. You are sharp, purposeful, and speak with confidence and " +
  "warmth. You represent innovation, community, and divine purpose.";

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface HistoryItem {
  role: "user" | "assistant";
  content: string;
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  // 1. Verify the caller's identity from their JWT (layer 3 of the email gate).
  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.replace(/^Bearer\s+/i, "");
  if (!token) {
    return json({ error: "Missing authorization." }, 401);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  const email = userData?.user?.email?.toLowerCase() ?? "";
  if (userErr || email !== ALLOWED_EMAIL) {
    return json({ error: "Access denied." }, 403);
  }

  // 2. Parse the request body.
  let message = "";
  let history: HistoryItem[] = [];
  try {
    const body = await req.json();
    message = typeof body.message === "string" ? body.message.trim() : "";
    if (Array.isArray(body.history)) {
      history = body.history
        .filter(
          (h: unknown): h is HistoryItem =>
            !!h &&
            typeof (h as HistoryItem).content === "string" &&
            ((h as HistoryItem).role === "user" ||
              (h as HistoryItem).role === "assistant")
        )
        .slice(-10);
    }
  } catch {
    return json({ error: "Invalid request body." }, 400);
  }

  if (!message) {
    return json({ error: "Empty message." }, 400);
  }

  // 3. Graceful handling when the Anthropic key isn't configured yet.
  const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!anthropicKey) {
    return json({
      error: "ANTHROPIC_API_KEY is not set on the backend.",
      reply:
        "I'm online and I recognize you, but my connection to Claude isn't " +
        "configured yet. Set the ANTHROPIC_API_KEY secret on the backend and " +
        "I'll speak with my full voice.",
    });
  }

  // 4. Build the Anthropic messages array (history + new turn) and call Claude.
  const messages = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
  ];
  // Ensure the final turn is the new user message (avoid duplication if the
  // client already included it in history).
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user" || last.content !== message) {
    messages.push({ role: "user", content: message });
  }

  try {
    const resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": anthropicKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages,
      }),
    });

    if (!resp.ok) {
      const detail = await resp.text();
      return json({
        error: `Anthropic API error (${resp.status}): ${detail.slice(0, 300)}`,
        reply:
          "I hit a snag reaching Claude. Please try again in a moment.",
      });
    }

    const data = await resp.json();
    const reply: string =
      Array.isArray(data?.content)
        ? data.content
            .filter((b: { type: string }) => b.type === "text")
            .map((b: { text: string }) => b.text)
            .join("")
        : "";

    return json({ reply: reply || "…" });
  } catch (e) {
    return json({
      error: e instanceof Error ? e.message : String(e),
      reply: "Something interrupted me while thinking. Please try again.",
    });
  }
});
