import { createClient as createSupabaseClient } from "@supabase/supabase-js";

/** Client server-side com a secret key — bypassa RLS. Nunca importar em Client Component. */
export function createAdminClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );
}
