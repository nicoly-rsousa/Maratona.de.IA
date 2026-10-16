import { createClient, type SupabaseClient } from "@supabase/supabase-js";

// Só a chave anon vai para o navegador. A service_role fica exclusivamente na API.
const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseConfigurado = () => Boolean(URL && ANON);

let client: SupabaseClient | null = null;

/** Criado sob demanda para o build não quebrar sem variáveis de ambiente. */
export function supabase(): SupabaseClient {
  if (!URL || !ANON) throw new Error("NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY não configuradas.");
  client ??= createClient(URL, ANON);
  return client;
}
