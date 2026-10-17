// Sobe o Farol inteiro em ambiente local com um único comando:  npm run dev
//   1. Docker: abre o Docker Desktop (Windows) se o engine não estiver no ar e espera ficar pronto.
//   2. Supabase local: `npx supabase start` se ainda não estiver rodando.
//   3. Banco: `scripts/db-local.mjs` (idempotente: migrations, usuários de teste, .env e dados demonstrativos).
//   4. API (:3001) e site (:3000) juntos neste terminal, com a saída prefixada; abre o navegador quando estiverem prontos.
// Ctrl+C encerra API e site. O Supabase continua no ar (para desligar: npx supabase stop).
// Opções: --sem-banco (pula o passo 3)  --sem-navegador (não abre o navegador)
import { execSync, spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { connect } from "node:net";
import { fileURLToPath } from "node:url";

const raiz = fileURLToPath(new URL("..", import.meta.url));
const windows = process.platform === "win32";
const args = new Set(process.argv.slice(2));
const SITE = "http://localhost:3000";
const API = "http://127.0.0.1:3001";

const espera = (ms) => new Promise((ok) => setTimeout(ok, ms));
const passo = (t) => console.log(`\n▶ ${t}`);
function falhar(msg) { console.error(`\n✖ ${msg}`); process.exit(1); }
function roda(cmd) {
  try { execSync(cmd, { cwd: raiz, stdio: "ignore" }); return true; } catch { return false; }
}

// Instalação recente do Docker Desktop no Windows: o terminal atual pode não ter o executável no PATH.
const DOCKER_BIN = "C:\\Program Files\\Docker\\Docker\\resources\\bin";
const DOCKER_APP = "C:\\Program Files\\Docker\\Docker\\Docker Desktop.exe";
if (windows && existsSync(DOCKER_BIN) && !process.env.PATH.toLowerCase().includes(DOCKER_BIN.toLowerCase())) {
  process.env.PATH = `${DOCKER_BIN};${process.env.PATH}`;
}

// ── 1. Docker ──
passo("Docker");
if (!roda("docker info")) {
  if (!windows || !existsSync(DOCKER_APP)) falhar("O Docker não está rodando. Abra o Docker e rode `npm run dev` de novo.");
  console.log("  abrindo o Docker Desktop…");
  spawn(DOCKER_APP, [], { detached: true, stdio: "ignore" }).unref();
  let pronto = false;
  for (let i = 0; i < 60 && !pronto; i++) { await espera(3000); pronto = roda("docker info"); }
  if (!pronto) falhar("O Docker não ficou pronto em 3 minutos. Abra o Docker Desktop, aceite os termos se pedir, e tente de novo.");
}
console.log("  ✓ engine no ar");

// ── 2. Supabase local ──
passo("Supabase local");
if (roda("npx supabase status")) {
  console.log("  ✓ já estava no ar");
} else {
  try { execSync("npx supabase start", { cwd: raiz, stdio: "inherit" }); } catch { falhar("`npx supabase start` falhou (veja a mensagem acima)."); }
}

// ── 3. Banco ──
if (args.has("--sem-banco")) {
  passo("Banco: pulado (--sem-banco)");
} else {
  try { execSync("node scripts/db-local.mjs", { cwd: raiz, stdio: "inherit" }); } catch { falhar("A preparação do banco falhou (veja a mensagem acima)."); }
}

// ── 4. API e site ──
passo("API e site");
const portaOcupada = (porta) =>
  new Promise((ok) => {
    const s = connect({ port: porta, host: "127.0.0.1" });
    s.once("connect", () => { s.destroy(); ok(true); });
    s.once("error", () => ok(false));
  });
for (const [porta, nome] of [[3001, "API"], [3000, "site"]]) {
  if (await portaOcupada(porta)) falhar(`A porta ${porta} (${nome}) já está em uso: o Farol já está rodando em outro terminal? Feche-o e tente de novo.`);
}

const filhos = [];
function iniciar(nome, script) {
  const p = spawn(`npm run ${script}`, { cwd: raiz, shell: true, detached: !windows, stdio: ["ignore", "pipe", "pipe"] });
  const prefixo = `[${nome}] `;
  const repassa = (dados) => {
    for (const linha of dados.toString().split(/\r?\n/)) if (linha.trim() && !linha.includes("npm notice")) console.log(prefixo + linha);
  };
  p.stdout.on("data", repassa);
  p.stderr.on("data", repassa);
  p.on("exit", (codigo) => { if (!encerrando) { console.error(`\n✖ ${nome} parou (código ${codigo}).`); encerrar(1); } });
  filhos.push(p);
}

let encerrando = false;
function encerrar(codigo = 0) {
  if (encerrando) return;
  encerrando = true;
  for (const p of filhos) {
    try {
      // npm → tsx/next → node: no Windows só o taskkill /T derruba a árvore inteira
      if (windows) execSync(`taskkill /PID ${p.pid} /T /F`, { stdio: "ignore" });
      else process.kill(-p.pid, "SIGTERM");
    } catch { /* já tinha saído */ }
  }
  console.log("\nAPI e site encerrados. O Supabase continua no ar (npx supabase stop para desligar).");
  process.exit(codigo);
}
process.on("SIGINT", () => encerrar(0));
process.on("SIGTERM", () => encerrar(0));

iniciar("api", "dev:api");
iniciar("web", "dev:web");

async function aguardar(url, segundos) {
  for (let i = 0; i < segundos; i++) {
    try { if ((await fetch(url)).ok) return true; } catch { /* ainda subindo */ }
    await espera(1000);
  }
  return false;
}
const [apiOk, siteOk] = await Promise.all([aguardar(`${API}/health`, 120), aguardar(`${SITE}/login`, 180)]);
if (!apiOk || !siteOk) {
  console.error(`\n⚠ ${!apiOk ? "A API" : "O site"} não respondeu a tempo; veja as mensagens acima. Os processos continuam rodando.`);
} else {
  console.log(`\n✔ Farol no ar: ${SITE}  (API ${API}, Supabase Studio http://127.0.0.1:54323)`);
  console.log("  Login: admin@farol.teste (e os demais @farol.teste). Ctrl+C encerra API e site.");
  if (!args.has("--sem-navegador")) {
    const abrir = windows ? `start "" ${SITE}` : process.platform === "darwin" ? `open ${SITE}` : `xdg-open ${SITE}`;
    try { execSync(abrir, { stdio: "ignore" }); } catch { /* sem navegador disponível */ }
  }
}
