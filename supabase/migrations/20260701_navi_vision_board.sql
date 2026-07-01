-- Vision Board tool: images + text goals arranged on a per-user grid.
-- Applied live via the Supabase Management API SQL endpoint.
CREATE TABLE IF NOT EXISTS navi_vision_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('image', 'text')),
  content text NOT NULL,
  position int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_navi_vision_items_email
  ON navi_vision_items(user_email, position);

ALTER TABLE navi_vision_items ENABLE ROW LEVEL SECURITY;
-- No RLS policies — edge function uses service role key which bypasses RLS

-- Public storage bucket for uploaded vision board images.
INSERT INTO storage.buckets (id, name, public)
VALUES ('vision-boards', 'vision-boards', true)
ON CONFLICT (id) DO NOTHING;
