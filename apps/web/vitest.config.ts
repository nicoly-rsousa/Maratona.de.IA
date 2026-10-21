import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Testes do front: funções puras (lib/) e componentes (jsdom + Testing Library). O Leaflet não roda no jsdom:
// testes de componente que tocam o mapa devem mockar `components/rede/mapa-rede` (nada de rede nem de Supabase aqui).
export default defineConfig({
  // tsconfig usa `jsx: preserve` (Next compila); no Vitest o esbuild precisa transformar o JSX.
  esbuild: { jsx: "automatic" },
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    environment: "jsdom",
    include: ["src/**/*.test.{ts,tsx}"],
    setupFiles: ["./src/test/setup.ts"],
    css: false,
    // testes de componente com jsdom competem por CPU quando o conjunto roda em paralelo (e o Docker local também pesa)
    testTimeout: 20_000,
  },
});
