import { env } from "./env.js";
import { criarApp } from "./app.js";
import { reclassificarAbertas } from "./jobs/reclassificar.js";

const app = await criarApp();

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
