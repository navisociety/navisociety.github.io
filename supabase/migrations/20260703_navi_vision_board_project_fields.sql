-- Vision Board: project name/notes/shape/size for each item.
-- Applied live via the Supabase Management API SQL endpoint.
ALTER TABLE navi_vision_items ADD COLUMN IF NOT EXISTS name text;
ALTER TABLE navi_vision_items ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE navi_vision_items ADD COLUMN IF NOT EXISTS shape text NOT NULL DEFAULT 'square' CHECK (shape IN ('circle', 'square'));
ALTER TABLE navi_vision_items ADD COLUMN IF NOT EXISTS size double precision NOT NULL DEFAULT 1 CHECK (size >= 0.5 AND size <= 2.5);
