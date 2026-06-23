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
    "[supabase] Missing VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY. " +
      "Supabase features are disabled until these env vars are set at build time."
  );
}

// A single shared client for the whole app. When env vars are missing we still
// create a client against placeholder values so imports don't throw; calls are
// guarded by `isSupabaseConfigured`.
export const supabase: SupabaseClient = createClient(
  supabaseUrl ?? "https://placeholder.supabase.co",
  supabaseAnonKey ?? "placeholder-anon-key"
);
