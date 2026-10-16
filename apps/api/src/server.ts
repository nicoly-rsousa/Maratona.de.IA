import Fastify from "fastify";
import cors from "@fastify/cors";
import { env } from "./env.js";
import { autenticar, permissoesDe } from "./auth.js";
import { rotasOS } from "./routes/os.js";
import { rotasCidades } from "./routes/cidades.js";
import { rotasDespacho } from "./routes/despacho.js";
import { reclassificarAbertas } from "./jobs/reclassificar.js";

const app = Fastify({ logger: true });
await app.register(cors, { origin: env.CORS_ORIGIN.split(","), credentials: true });

// Health check público (Render usa para saber se o deploy subiu)
app.get("/health", async () => ({ ok: true, ts: new Date().toISOString() }));

// Tudo abaixo exige login
await app.register(async (r) => {
  r.addHook("preHandler", autenticar);
  r.get("/me", async (req) => ({ ...req.ator!, permissoes: permissoesDe(req.ator!.perfil) }));
  await r.register(rotasCidades);
  await r.register(rotasOS);
  await r.register(rotasDespacho);
});

// Reclassificação a cada 60 s (§7). Com 1 instância no Render isso basta;
// para escalar, mover para Cron Job (npm run job:reclassificar) ou pg_cron.
setInterval(() => reclassificarAbertas().catch((e) => app.log.error(e)), 60_000);

await app.listen({ port: env.PORT, host: "0.0.0.0" });
