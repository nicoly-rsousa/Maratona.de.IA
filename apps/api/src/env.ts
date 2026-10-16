import { z } from "zod";
import { PARAMS_DUPLICIDADE_PADRAO } from "@farol/shared";

const Env = z.object({
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_ROLE_KEY: z.string().min(20),
  CORS_ORIGIN: z.string().default("http://localhost:3000"),
  PORT: z.coerce.number().default(3001),
  // Duplicidade (§11): sem tabela de configuração no schema, valores demonstrativos ajustáveis por ambiente.
  DUP_RAIO_M: z.coerce.number().positive().default(PARAMS_DUPLICIDADE_PADRAO.raioM),
  DUP_JANELA_H: z.coerce.number().positive().default(PARAMS_DUPLICIDADE_PADRAO.janelaH),
});
export const env = Env.parse(process.env);
