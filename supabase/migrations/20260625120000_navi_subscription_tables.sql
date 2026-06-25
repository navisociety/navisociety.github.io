-- Subscription / usage / conversation / plan tables for Mini & Max tiers
-- Recreated on project irssegzkvxyewuxgqpwi (2026-06-25) — not carried over by project migration.

CREATE TABLE IF NOT EXISTS navi_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  tier text NOT NULL,
  paypal_subscription_id text,
  status text NOT NULL DEFAULT 'active',
  started_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS navi_usage (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  tier text,
  month_key text NOT NULL,
  usd_spent double precision NOT NULL DEFAULT 0,
  last_updated timestamptz DEFAULT now(),
  CONSTRAINT navi_usage_email_month_unique UNIQUE (email, month_key)
);

CREATE TABLE IF NOT EXISTS navi_conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL,
  role text NOT NULL,
  content text NOT NULL,
  tier text DEFAULT 'free',
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS navi_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tier text NOT NULL,
  plan_id text NOT NULL,
  product_id text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE navi_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE navi_usage ENABLE ROW LEVEL SECURITY;
ALTER TABLE navi_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE navi_plans ENABLE ROW LEVEL SECURITY;
-- No RLS policies: edge functions use the service role key (bypasses RLS).
-- The frontend never queries these tables directly.

-- Atomic per-month usage increment. Returns the new running total.
-- Used by navi-mini / navi-max to avoid read-then-write races when
-- concurrent calls would otherwise overwrite each other's spend.
CREATE OR REPLACE FUNCTION navi_add_usage(p_email text, p_tier text, p_month_key text, p_cost double precision)
RETURNS double precision
LANGUAGE plpgsql
SECURITY DEFINER
AS $func$
DECLARE
  v_total double precision;
BEGIN
  INSERT INTO navi_usage (email, tier, month_key, usd_spent, last_updated)
  VALUES (p_email, p_tier, p_month_key, p_cost, now())
  ON CONFLICT (email, month_key)
  DO UPDATE SET usd_spent = navi_usage.usd_spent + EXCLUDED.usd_spent, last_updated = now()
  RETURNING usd_spent INTO v_total;
  RETURN v_total;
END;
$func$;
