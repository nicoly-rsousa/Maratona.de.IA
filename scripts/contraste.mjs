// Verifica o contraste WCAG 2.2 AA dos pares de tokens usados na interface, nos temas claro e escuro.
// Uso: npm run check:contrast   (lê apps/web/src/styles/tokens.css; sai com código 1 se algum par ficar abaixo do mínimo)
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../apps/web/src/styles/tokens.css", import.meta.url), "utf8");

/** Variáveis de cor declaradas no bloco que começa em `seletor`. */
function bloco(seletor) {
  const ini = css.indexOf(`${seletor} {`);
  if (ini < 0) throw new Error(`Bloco ${seletor} não encontrado em tokens.css`);
  const corpo = css.slice(ini, css.indexOf("\n}", ini));
  return Object.fromEntries([...corpo.matchAll(/(--color-[\w-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2]]));
}

const claro = bloco(":root");
const temas = { claro, escuro: { ...claro, ...bloco(':root[data-t="d"]') } };

const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const razao = (a, b) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const TEXTO = 4.5; // texto normal
const UI = 3; // componentes de interface e texto grande

const SUPERFICIES = ["--color-bg", "--color-surface", "--color-surface-alt"];
/** [frente, fundo(s), mínimo, descrição] */
const PARES = [
  ["--color-text", [...SUPERFICIES, "--color-surface-sunken"], TEXTO, "texto principal"],
  ["--color-text-muted", [...SUPERFICIES, "--color-surface-sunken"], TEXTO, "texto de apoio"],
  ["--color-primary", SUPERFICIES, TEXTO, "links e ações secundárias"],
  ["--color-primary", ["--color-primary-soft"], TEXTO, "item selecionado"],
  ["--color-on-primary", ["--color-primary", "--color-primary-hover"], TEXTO, "botão primário"],
  ["--color-border-strong", SUPERFICIES, UI, "contorno de controles"],
  ["--color-focus", SUPERFICIES, UI, "anel de foco"],
  ["--color-danger", ["--color-danger-bg", "--color-surface"], TEXTO, "erro"],
  ["--color-warning", ["--color-warning-bg", "--color-surface"], TEXTO, "aviso"],
  ["--color-success", ["--color-success-bg", "--color-surface"], TEXTO, "sucesso"],
  ["--color-info", ["--color-info-bg", "--color-surface"], TEXTO, "informação"],
  ["--color-danger-border", ["--color-danger-bg"], UI, "borda de erro"],
  ["--color-warning-border", ["--color-warning-bg"], UI, "borda de aviso"],
  ["--color-success-border", ["--color-success-bg"], UI, "borda de sucesso"],
  ["--color-info-border", ["--color-info-bg"], UI, "borda de informação"],
  ...["emergente", "urgente", "alta", "media", "baixa"].flatMap((p) => [
    ["--color-on-priority", [`--color-priority-${p}`], TEXTO, `rótulo da prioridade ${p}`],
    [`--color-priority-${p}`, ["--color-surface"], UI, `marcador da prioridade ${p}`],
  ]),
];

let falhas = 0;
for (const [tema, cores] of Object.entries(temas)) {
  console.log(`\nTema ${tema}`);
  for (const [fg, fundos, min, desc] of PARES) {
    for (const bg of fundos) {
      const r = razao(cores[fg], cores[bg]);
      const ok = r >= min;
      if (!ok) falhas++;
      console.log(`${ok ? "OK   " : "FALHA"} ${r.toFixed(2).padStart(5)}:1 (mín ${min}) ${fg} sobre ${bg} — ${desc}`);
    }
  }
}
console.log(falhas ? `\n${falhas} par(es) abaixo do mínimo.` : "\nTodos os pares atendem WCAG 2.2 AA.");
process.exit(falhas ? 1 : 0);
