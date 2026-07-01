-- Choice tool: pros/cons decisions with a saved, deletable NAVI verdict.
-- Applied live via the Supabase Management API SQL endpoint.
CREATE TABLE IF NOT EXISTS navi_choices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email text NOT NULL,
  question text NOT NULL,
  pros text NOT NULL DEFAULT '',
  cons text NOT NULL DEFAULT '',
  verdict text NOT NULL,
  answer text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_navi_choices_email
  ON navi_choices(user_email, created_at DESC);

ALTER TABLE navi_choices ENABLE ROW LEVEL SECURITY;
-- No RLS policies — edge function uses service role key which bypasses RLS
