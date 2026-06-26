// navi-paypal — PayPal Live subscriptions
// verify_jwt: false. Frontend sends NO Authorization header.

const ALLOWED_ORIGINS = [
  "https://navisociety.github.io",
  "http://localhost:5173",
  "http://localhost:3000",
  "http://127.0.0.1:5173",
];

function corsHeaders(origin: string | null): Record<string, string> {
  const allow = origin && ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-client-info, apikey",
    "Content-Type": "application/json",
  };
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const PAYPAL_CLIENT_ID = Deno.env.get("PAYPAL_CLIENT_ID")!;
const PAYPAL_SECRET = Deno.env.get("PAYPAL_SECRET")!;
const PAYPAL_API = "https://api-m.paypal.com";

// tier -> monthly price (USD)
const TIER_PRICE: Record<string, string> = { mini: "10", max: "20" };
const TIER_NAME: Record<string, string> = { mini: "NAVI Mini", max: "NAVI Max" };

async function sb(path: string, init: RequestInit): Promise<Response> {
  return await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      ...(init.headers || {}),
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      "Content-Type": "application/json",
    },
  });
}

async function getAccessToken(): Promise<string> {
  const basic = btoa(`${PAYPAL_CLIENT_ID}:${PAYPAL_SECRET}`);
  const res = await fetch(`${PAYPAL_API}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${basic}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    throw new Error(data.error_description || "Failed to get PayPal access token");
  }
  return data.access_token;
}

// Returns a cached or newly created plan_id for the tier
async function getOrCreatePlan(token: string, tier: string): Promise<string> {
  // Check cache
  const cacheRes = await sb(`navi_plans?tier=eq.${tier}&select=plan_id&order=created_at.desc&limit=1`, {
    method: "GET",
  });
  const cached = await cacheRes.json();
  if (Array.isArray(cached) && cached.length > 0 && cached[0].plan_id) {
    return cached[0].plan_id;
  }

  // Create product
  const prodRes = await fetch(`${PAYPAL_API}/v1/catalogs/products`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: TIER_NAME[tier], type: "SERVICE" }),
  });
  const prod = await prodRes.json();
  if (!prodRes.ok || !prod.id) {
    throw new Error("Failed to create PayPal product");
  }

  // Create billing plan
  const planRes = await fetch(`${PAYPAL_API}/v1/billing/plans`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      product_id: prod.id,
      name: `${TIER_NAME[tier]} Monthly`,
      billing_cycles: [
        {
          tenure_type: "REGULAR",
          sequence: 1,
          total_cycles: 0,
          pricing_scheme: { fixed_price: { value: TIER_PRICE[tier], currency_code: "USD" } },
          frequency: { interval_unit: "MONTH", interval_count: 1 },
        },
      ],
      payment_preferences: {
        auto_bill_outstanding: true,
        setup_fee_failure_action: "CONTINUE",
        payment_failure_threshold: 3,
      },
    }),
  });
  const plan = await planRes.json();
  if (!planRes.ok || !plan.id) {
    throw new Error("Failed to create PayPal plan");
  }

  // Cache plan
  await sb(`navi_plans`, {
    method: "POST",
    headers: { Prefer: "return=minimal" },
    body: JSON.stringify({ tier, plan_id: plan.id, product_id: prod.id }),
  });

  return plan.id;
}

Deno.serve(async (req) => {
  const origin = req.headers.get("origin");
  const headers = corsHeaders(origin);

  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200, headers });
  }

  try {
    const body = await req.json();
    const action: string = body.action || "";

    if (action === "get-access-token") {
      const token = await getAccessToken();
      return new Response(JSON.stringify({ access_token: token }), { status: 200, headers });
    }

    if (action === "create-subscription") {
      const tier: string = body.tier || "";
      const email: string = body.email || "";
      if (!TIER_PRICE[tier]) {
        return new Response(JSON.stringify({ error: "invalid tier" }), { status: 200, headers });
      }
      const token = await getAccessToken();
      const planId = await getOrCreatePlan(token, tier);

      const subRes = await fetch(`${PAYPAL_API}/v1/billing/subscriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          plan_id: planId,
          subscriber: { email_address: email },
          application_context: {
            return_url: "https://navisociety.github.io",
            cancel_url: "https://navisociety.github.io",
            user_action: "SUBSCRIBE_NOW",
          },
        }),
      });
      const sub = await subRes.json();
      if (!subRes.ok || !sub.id) {
        return new Response(JSON.stringify({ error: "Could not create subscription" }), { status: 200, headers });
      }
      const approveLink = Array.isArray(sub.links)
        ? sub.links.find((l: { rel: string; href: string }) => l.rel === "approve")
        : null;
      return new Response(
        JSON.stringify({ subscriptionId: sub.id, approvalUrl: approveLink ? approveLink.href : null }),
        { status: 200, headers }
      );
    }

    if (action === "activate") {
      const subscriptionId: string = body.subscriptionId || "";
      const email: string = body.email || "";
      const tier: string = body.tier || "";
      if (!subscriptionId || !email || !tier) {
        return new Response(JSON.stringify({ error: "missing fields" }), { status: 200, headers });
      }
      const token = await getAccessToken();
      const verifyRes = await fetch(`${PAYPAL_API}/v1/billing/subscriptions/${subscriptionId}`, {
        method: "GET",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      });
      const sub = await verifyRes.json();
      if (!verifyRes.ok || sub.status !== "ACTIVE") {
        return new Response(JSON.stringify({ error: "subscription not active" }), { status: 200, headers });
      }

      await sb(`navi_subscriptions`, {
        method: "POST",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({
          email,
          tier,
          paypal_subscription_id: subscriptionId,
          status: "active",
          started_at: new Date().toISOString(),
        }),
      });

      return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    }

    if (action === "cancel-subscription") {
      const email: string = body.email || "";
      if (!email) {
        return new Response(JSON.stringify({ error: "missing email" }), { status: 200, headers });
      }

      // Find this user's most recent ACTIVE subscription.
      const subsRes = await sb(
        `navi_subscriptions?email=eq.${encodeURIComponent(email)}&status=eq.active&order=created_at.desc&limit=1`,
        { method: "GET" }
      );
      const subs = await subsRes.json();
      if (!Array.isArray(subs) || subs.length === 0) {
        return new Response(JSON.stringify({ error: "no active subscription" }), { status: 200, headers });
      }
      const paypalSubId: string | undefined = subs[0].paypal_subscription_id;

      // Cancel at PayPal (best-effort: if it's already cancelled/expired there,
      // we still mark it inactive on our side so the user is downgraded).
      if (paypalSubId) {
        try {
          const token = await getAccessToken();
          await fetch(`${PAYPAL_API}/v1/billing/subscriptions/${paypalSubId}/cancel`, {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ reason: "Customer requested cancellation" }),
          });
        } catch (_) {
          /* fall through and downgrade locally */
        }
      }

      // Downgrade: mark every active subscription row for this email as cancelled.
      // getSubscriptionStatus only counts status=active, so this revokes access.
      await sb(`navi_subscriptions?email=eq.${encodeURIComponent(email)}&status=eq.active`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ status: "cancelled" }),
      });

      // Keep the profile badge in sync (best-effort).
      await sb(`profiles?email=eq.${encodeURIComponent(email)}`, {
        method: "PATCH",
        headers: { Prefer: "return=minimal" },
        body: JSON.stringify({ subscription_tier: "free", subscription_status: "cancelled" }),
      });

      return new Response(JSON.stringify({ success: true }), { status: 200, headers });
    }

    return new Response(JSON.stringify({ error: "unknown action" }), { status: 200, headers });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e instanceof Error ? e.message : e) }), { status: 200, headers });
  }
});
