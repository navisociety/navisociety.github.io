/**
 * navi-brain/poll.js
 *
 * LOCAL plumbing for the NAVI Claude Code agent. This is NOT shipped in the
 * frontend bundle and is NOT run in CI. It talks to Supabase with the SERVICE
 * ROLE key, which bypasses RLS, so it must only ever run on Navi's trusted
 * local machine.
 *
 *   SECURITY: the service role key is read from the environment. NEVER hardcode
 *   it and NEVER commit it. Set SUPABASE_SERVICE_ROLE_KEY in your local env
 *   (e.g. navi-brain/.env, which is gitignored).
 *
 * Flow Navi follows each tick:
 *   1. listPending()            -> all pending user messages (oldest first),
 *                                  each with the last 10 messages of context.
 *   2. <Navi generates a reply at runtime for each one>
 *   3. postReply(...)           -> insert the assistant row and mark the
 *                                  originating user message answered.
 */

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = "https://irssegzkvxyewuxgqpwi.supabase.co";
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SERVICE_ROLE_KEY) {
  throw new Error(
    "SUPABASE_SERVICE_ROLE_KEY is not set. Export it in your local env " +
      "(see navi-brain/README.md). Never hardcode or commit this key."
  );
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

/**
 * Fetch every pending user message (oldest first). For each, also fetch the
 * last 10 messages for that same user_id (oldest first) so Navi has context.
 *
 * @returns {Promise<Array<{ message: object, context: object[] }>>}
 */
async function listPending() {
  const { data: pending, error } = await supabase
    .from("messages")
    .select("id, user_id, role, content, status, created_at")
    .eq("role", "user")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (error) throw error;
  if (!pending || pending.length === 0) return [];

  const results = [];
  for (const message of pending) {
    const { data: recent, error: ctxError } = await supabase
      .from("messages")
      .select("id, role, content, status, created_at")
      .eq("user_id", message.user_id)
      .order("created_at", { ascending: false })
      .limit(10);

    if (ctxError) throw ctxError;

    const context = (recent ?? []).slice().reverse();
    results.push({ message, context });
  }

  return results;
}

/**
 * Post Navi's reply for a given user message: insert the assistant row, then
 * mark the originating user message as answered.
 *
 * @param {object} params
 * @param {string} params.userId          - user_id the reply belongs to
 * @param {string} params.content         - the assistant reply text (from Navi)
 * @param {string} params.userMessageId   - id of the user message being answered
 * @returns {Promise<object>} the inserted assistant row
 */
async function postReply({ userId, content, userMessageId }) {
  if (!userId) throw new Error("postReply: userId is required");
  if (!content) throw new Error("postReply: content is required");

  const { data: inserted, error: insertError } = await supabase
    .from("messages")
    .insert({
      user_id: userId,
      role: "assistant",
      content,
      status: "answered",
    })
    .select("id, user_id, role, content, status, created_at")
    .single();

  if (insertError) throw insertError;

  if (userMessageId) {
    const { error: updateError } = await supabase
      .from("messages")
      .update({ status: "answered" })
      .eq("id", userMessageId);
    if (updateError) throw updateError;
  }

  return inserted;
}

module.exports = { supabase, listPending, postReply };

// When run directly, print the pending queue + context as JSON so Navi can
// read it. Reply generation + posting is driven by Navi at runtime.
if (require.main === module) {
  listPending()
    .then((queue) => {
      console.log(JSON.stringify(queue, null, 2));
      console.log(`\n${queue.length} pending message(s).`);
    })
    .catch((err) => {
      console.error("poll failed:", err.message);
      process.exit(1);
    });
}
