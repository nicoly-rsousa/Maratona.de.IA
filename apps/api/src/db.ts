import { createClient } from "@supabase/supabase-js";
import { env } from "./env.js";

/** Cliente com service_role: ignora RLS. Por isso TODO filtro de cidade é feito em auth.ts/rotas. */
export const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/** Linha crua de uma tabela (ordens_servico, versoes_pontuacao…), como o PostgREST devolve. */
export type Linha = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any -- colunas variam por consulta

/** Filtro PostgREST dos status finais: `.not("status", "in", STATUS_FINAIS)` = só OS abertas. */
export const STATUS_FINAIS = "(Concluída,Cancelada)";
