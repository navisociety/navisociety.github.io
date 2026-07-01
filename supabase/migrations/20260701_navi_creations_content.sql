-- Add optional freeform content for the Create tool.
-- When present, the Create tool generates a sized .pptx (first non-blank line
-- = headline, rest = body) and imports it into Canva as a real, editable
-- design of the detected dimensions. Nullable/additive; safe to re-run.
-- Applied live via the Supabase Management API SQL endpoint.
ALTER TABLE navi_creations ADD COLUMN IF NOT EXISTS content text;
