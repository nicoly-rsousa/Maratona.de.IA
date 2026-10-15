import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/server.ts", "src/jobs/reclassificar.ts", "src/seed.ts"],
  format: ["esm"],
  outDir: "dist",
  target: "node22",
  noExternal: ["@farol/shared"], // o pacote shared é TS puro: precisa ser embutido no bundle
  clean: true,
});
