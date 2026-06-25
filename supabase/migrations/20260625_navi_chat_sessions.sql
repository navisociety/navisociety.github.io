-- Chat sessions: each conversation becomes a named "file" in the Chats screen.
CREATE TABLE IF NOT EXISTS navi_chat_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  title text NOT NULL DEFAULT 'New Chat',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE navi_conversations
  ADD COLUMN IF NOT EXISTS session_id uuid REFERENCES navi_chat_sessions(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_navi_chat_sessions_email
  ON navi_chat_sessions(email, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_navi_conversations_session
  ON navi_conversations(session_id);

ALTER TABLE navi_chat_sessions ENABLE ROW LEVEL SECURITY;
-- No RLS policies — edge functions use service role key which bypasses RLS
