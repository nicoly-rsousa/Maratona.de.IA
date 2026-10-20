import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "./env.js";
import { autenticar, permissoesDe } from "./auth.js";
import { rotasOS } from "./routes/os.js";
import { rotasCidades } from "./routes/cidades.js";
import { rotasDespacho } from "./routes/despacho.js";
import { rotasPontuacao } from "./routes/pontuacao.js";
import { rotasMapa } from "./routes/mapa.js";
import { rotasRegras } from "./routes/regras.js";
import { rotasRede } from "./routes/rede.js";

/** Monta a API sem abrir porta nem agendar jobs (server.ts faz isso). Os testes usam `app.inject`. */
export async function criarApp(opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ?? true });
  // PUT precisa estar liberado: o padrão do @fastify/cors é só GET, HEAD e POST (PUT /pontuacao/rascunho)
  await app.register(cors, { origin: env.CORS_ORIGIN.split(","), credentials: true, methods: ["GET", "HEAD", "POST", "PUT"] });

  // Health check público (Render usa para saber se o deploy subiu)
  app.get("/health", async () => ({ ok: true, ts: new Date().toISOString() }));

  // Tudo abaixo exige login
  await app.register(async (r) => {
    r.addHook("preHandler", autenticar);
    r.get("/me", async (req) => ({ ...req.ator!, permissoes: permissoesDe(req.ator!.perfil) }));
    await r.register(rotasCidades);
    await r.register(rotasOS);
    await r.register(rotasDespacho);
    await r.register(rotasPontuacao);
    await r.register(rotasMapa);
    await r.register(rotasRegras);
    await r.register(rotasRede);
  });
  return app;
}
