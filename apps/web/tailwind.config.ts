import type { Config } from "tailwindcss";

// Tailwind = só utilitários de layout pontual. Cores substituem (não estendem) a paleta padrão:
// qualquer cor vem dos tokens de src/styles/tokens.css (tema claro padrão; html[data-t="d"] = escuro).
const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    screens: { sm: "640px", md: "768px", lg: "1024px", xl: "1280px" },
    colors: {
      transparent: "transparent",
      current: "currentColor",
      inherit: "inherit",
      bg: "var(--color-bg)",
      surface: "var(--color-surface)",
      "surface-alt": "var(--color-surface-alt)",
      fg: "var(--color-text)",
      muted: "var(--color-text-muted)",
      primary: "var(--color-primary)",
      line: "var(--color-border-subtle)",
      danger: "var(--color-danger)",
      warning: "var(--color-warning)",
      success: "var(--color-success)",
    },
    fontSize: {
      xs: "var(--font-size-xs)",
      sm: "var(--font-size-sm)",
      base: "var(--font-size-base)",
      md: "var(--font-size-md)",
      lg: "var(--font-size-lg)",
      xl: "var(--font-size-xl)",
    },
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)"],
        mono: ["var(--font-mono)"],
      },
    },
  },
  plugins: [],
};

export default config;
