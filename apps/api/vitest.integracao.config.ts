import { defineConfig } from "vitest/config";

// Só contra o Supabase LOCAL (127.0.0.1:54321/54322). Rode com `npm run test:integracao` (carrega .env.docker).
export default defineConfig({
  test: { include: ["src/**/*.integracao.test.ts"], testTimeout: 30_000, hookTimeout: 60_000, fileParallelism: false },
});
