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
import { reclassificarAbertas } from "./jobs/reclassificar.js";

const app = Fastify({ logger: true });
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
});

// Reclassificação a cada 60 s (§7). Com 1 instância no Render isso basta;
// para escalar, mover para Cron Job (npm run job:reclassificar) ou pg_cron.
setInterval(() => reclassificarAbertas().catch((e) => app.log.error(e)), 60_000);

try {
  await app.listen({ port: env.PORT, host: "0.0.0.0" });
} catch (e) {
  // Porta ocupada quase sempre é a própria API já rodando (outro terminal com `npm run dev:api`): avisar em vez de despejar a pilha.
  if ((e as NodeJS.ErrnoException).code === "EADDRINUSE") {
    console.error(`A porta ${env.PORT} já está em uso: a API provavelmente já está rodando em outro terminal (confira http://127.0.0.1:${env.PORT}/health).`);
    process.exit(1);
  }
  throw e;
}
