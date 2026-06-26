-- Drop old Brevo-based outbox table
DROP TABLE IF EXISTS navi_emails CASCADE;

-- Gmail OAuth token storage
CREATE TABLE IF NOT EXISTS navi_gmail_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_email text NOT NULL UNIQUE,
  access_token text NOT NULL,
  refresh_token text NOT NULL,
  expires_at timestamptz NOT NULL,
  gmail_address text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);
