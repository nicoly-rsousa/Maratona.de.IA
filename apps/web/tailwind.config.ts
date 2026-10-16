import type { Config } from "tailwindcss";

// Cores = variáveis do protótipo docs/farol.html (tema escuro por padrão; data-t="l" = claro).
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  // Pill monta `k${codigo}` dinamicamente: sem isto o Tailwind remove as cores das pílulas.
  safelist: ["k0", "k1", "k2", "k3", "k4"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)", p1: "var(--p1)", p2: "var(--p2)", ln: "var(--ln)", tx: "var(--tx)",
        mu: "var(--mu)", ac: "var(--ac)", ok: "var(--ok)",
        c0: "var(--c0)", c1: "var(--c1)", c2: "var(--c2)", c3: "var(--c3)", c4: "var(--c4)",
      },
      fontFamily: { mono: ["ui-monospace", "Menlo", "Consolas", "monospace"] },
    },
  },
  plugins: [],
};

export default config;
