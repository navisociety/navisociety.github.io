/**
 * navi-runner/poll.js — NAVI's hands on THIS device (v39).
 *
 * Runs ONCE and exits (navi-brain pattern): polls the navi_memory profile for
 * auto tasks queued to this device ("run backup on my pc" in chat), executes
 * the ones whose NAME is defined in the LOCAL allowlist (tasks.config.json,
 * beside this file), and writes a one-line receipt back onto each task.
 * Chat reads receipts with "any results from my <device>".
 *
 * THE SAFETY CONTRACT
 *   - Chat only ever queues a NAME. What a name executes is defined HERE, in
 *     tasks.config.json, which chat can never write. A name this device
 *     doesn't define is refused with an honest receipt — never guessed.
 *   - The runner POLLS. NAVI never pushes to a device; schedule this script
 *     yourself (Task Scheduler / cron) or run it by hand. That keeps the
 *     no-server-push rule: the device pulls, on the owner's terms.
 *   - Only put commands in the allowlist that are safe to run at ANY time
 *     and whose output is fine to appear in your NAVI chat.
 *
 * SECURITY: the service role key bypasses RLS — read it from the environment
 * (navi-runner/.env is gitignored), NEVER hardcode or commit it.
 *
 * Setup:
 *   1. copy tasks.config.example.json -> tasks.config.json, define your names
 *   2. set SUPABASE_SERVICE_ROLE_KEY, NAVI_EMAIL, NAVI_DEVICE in the env
 *   3. node navi-runner/poll.js   (schedule it if you want it hands-free)
 */

// ESM on purpose: the repo's package.json declares "type": "module", so a
// require() here throws before the first line runs (found the hard way on
// the first real device setup, v42).
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const __dirname = import.meta.dirname;

const SUPABASE_URL = "https://irssegzkvxyewuxgqpwi.supabase.co";
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const EMAIL = process.env.NAVI_EMAIL;
const DEVICE = (process.env.NAVI_DEVICE || "").toLowerCase().trim();
const TIMEOUT_MS = 120000;

if (!SERVICE_KEY) throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set (see navi-runner/README.md).");
if (!EMAIL) throw new Error("NAVI_EMAIL is not set — whose task queue should I poll?");
if (!DEVICE) throw new Error("NAVI_DEVICE is not set — which device is this? (must match what you call it in chat)");

const configPath = path.join(__dirname, "tasks.config.json");
if (!fs.existsSync(configPath)) {
  throw new Error("tasks.config.json not found — copy tasks.config.example.json and define this device's allowlist.");
}
const allowlist = JSON.parse(fs.readFileSync(configPath, "utf8"));

const headers = {
  apikey: SERVICE_KEY,
  Authorization: `Bearer ${SERVICE_KEY}`,
  "Content-Type": "application/json",
};

async function main() {
  const url = `${SUPABASE_URL}/rest/v1/navi_memory?email=eq.${encodeURIComponent(EMAIL)}&select=profile&limit=1`;
  const res = await fetch(url, { headers });
  if (!res.ok) throw new Error(`profile read failed: HTTP ${res.status}`);
  const rows = await res.json();
  const profile = rows[0] && rows[0].profile && typeof rows[0].profile === "object" ? rows[0].profile : null;
  if (!profile) { console.log("no profile row — nothing to do."); return; }

  const tasks = Array.isArray(profile.deviceTasks) ? profile.deviceTasks : [];
  const mine = tasks.filter((t) => t && t.device === DEVICE && t.auto && !t.result);
  if (!mine.length) { console.log(`no auto tasks waiting for "${DEVICE}".`); return; }

  for (const task of mine) {
    const name = String(task.text);
    const command = allowlist[name];
    if (typeof command !== "string" || !command.trim()) {
      task.result = `refused — "${name}" isn't in this device's allowlist`;
      console.log(`refused: ${name}`);
      continue;
    }
    try {
      const out = execSync(command, { timeout: TIMEOUT_MS, encoding: "utf8", windowsHide: true });
      const line = (out || "").trim().split(/\r?\n/).filter(Boolean).pop() || "no output";
      task.result = `ok — ${line.slice(0, 120)}`;
      console.log(`ok: ${name}`);
    } catch (err) {
      const line = String((err && (err.stderr || err.message)) || "failed").trim().split(/\r?\n/)[0];
      task.result = `failed — ${line.slice(0, 120)}`;
      console.log(`failed: ${name} (${line.slice(0, 120)})`);
    }
    task.ranAt = new Date().toISOString();
  }

  const patch = await fetch(
    `${SUPABASE_URL}/rest/v1/navi_memory?email=eq.${encodeURIComponent(EMAIL)}`,
    { method: "PATCH", headers: { ...headers, Prefer: "return=minimal" }, body: JSON.stringify({ profile }) },
  );
  if (!patch.ok) throw new Error(`receipt write failed: HTTP ${patch.status}`);
  console.log(`${mine.length} task(s) processed — receipts written. Ask NAVI: "any results from my ${DEVICE}".`);
}

main().catch((err) => {
  console.error("runner failed:", err.message);
  process.exit(1);
});
