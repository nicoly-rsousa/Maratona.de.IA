import { defineConfig } from "vitest/config";

// Testes unitários: sem rede e sem banco (o cliente `db` é simulado). A integração com login real fica em vitest.integracao.config.ts.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.integracao.test.ts", "node_modules/**"],
    setupFiles: ["./src/test/setup-env.ts"],
  },
});
