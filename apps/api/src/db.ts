import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

/** Cliente com service_role: ignora RLS. Por isso TODO filtro de cidade é feito em auth.ts/rotas. */
export const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});
