# navi-brain

Local plumbing that lets the **NAVI Claude Code agent** answer chat messages from
the NAVISOCIETY site. This runs **locally on Navi's machine only** — never in CI,
never in the frontend bundle.

## How it works

1. The website writes each user message into the Supabase `messages` table with
   `status = 'pending'`.
2. Navi runs `poll.js` locally. It lists pending user messages (oldest first),
   each bundled with the last 10 messages of that user's conversation as context.
3. Navi reads the context, generates a reply, and posts it back with
   `postReply(...)`, which inserts an `assistant` row (`status = 'answered'`) and
   marks the original user message answered.
4. The website is subscribed to Supabase Realtime and renders the assistant
   reply the moment it lands.

## Security — read this

`poll.js` uses the Supabase **service role key**, which bypasses RLS. Treat it
like a root password.

- The key is read from `process.env.SUPABASE_SERVICE_ROLE_KEY`. It is **never**
  hardcoded.
- **Never commit the service role key.** Not to this repo, not anywhere. It must
  never appear in any frontend `VITE_` var, the bundle, or GitHub Actions.
- Keep it in `navi-brain/.env` (gitignored) or your shell environment only.

## Setup

```sh
# from the repo root
npm install            # @supabase/supabase-js is already a project dependency

# provide the service role key (one of these):
export SUPABASE_SERVICE_ROLE_KEY="sb_secret_..."   # current shell
# or create navi-brain/.env with:
#   SUPABASE_SERVICE_ROLE_KEY=sb_secret_...
```

## Run

```sh
# print the pending queue + context as JSON
node navi-brain/poll.js
```

Inside Navi's agent runtime, import the helpers instead of running the CLI:

```js
const { listPending, postReply } = require("./navi-brain/poll");

const queue = await listPending();
for (const { message, context } of queue) {
  const reply = /* Navi generates this from `context` */;
  await postReply({
    userId: message.user_id,
    content: reply,
    userMessageId: message.id,
  });
}
```
