-- Vision Board: freely-draggable node positions for the cloud/web canvas.
-- Applied live via the Supabase Management API SQL endpoint.
ALTER TABLE navi_vision_items ADD COLUMN IF NOT EXISTS x double precision;
ALTER TABLE navi_vision_items ADD COLUMN IF NOT EXISTS y double precision;
