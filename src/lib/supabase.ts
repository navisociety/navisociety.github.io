import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Publishable (anon) values — safe to ship in the frontend bundle.
// Provided at build time via Vite env vars (see .github/workflows/deploy.yml).
const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as
  | string
  | undefined;

export const isSupabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);

if (!isSupabaseConfigured) {
  // Don't crash the app — render gracefully and log a clear warning.
  console.warn(
    "[backend] Missing build-time configuration. Some features are disabled " +
      "until the required env vars are set at build time."
  );
}

// The single account permitted to access NAVI.
export const ALLOWED_EMAIL = "prophetdian@gmail.com";

// The site origin used as the OAuth redirect target.
export const SITE_URL = "https://navisociety.github.io";

// A single shared client for the whole app. When env vars are missing we still
// create a client against placeholder values so imports don't throw; calls are
// guarded by `isSupabaseConfigured`.
export const supabase: SupabaseClient = createClient(
  supabaseUrl ?? "https://placeholder.supabase.co",
  supabaseAnonKey ?? "placeholder-anon-key",
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  }
);
