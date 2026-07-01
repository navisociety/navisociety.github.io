-- Vision Board: per-user Home circle profile (name + little bio).
-- Applied live via the Supabase Management API SQL endpoint.
CREATE TABLE IF NOT EXISTS navi_vision_profile (
  user_email text PRIMARY KEY,
  name text NOT NULL DEFAULT '',
  bio text NOT NULL DEFAULT '',
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE navi_vision_profile ENABLE ROW LEVEL SECURITY;
-- No RLS policies — edge function uses service role key which bypasses RLS
