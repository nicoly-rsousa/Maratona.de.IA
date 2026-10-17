// Monta o banco do Farol no Supabase LOCAL (Docker) e deixa a API e o site prontos para `npm run dev:api` / `npm run dev:web`.
// Uso: npm run db:local   (antes: Docker Desktop aberto e `npx supabase start` concluído)
//
// 1. Aplica os SQL na ordem do README: 0001 → seed.sql → 0002 … 0007 (0001 só se o schema ainda não existe; as demais
//    são idempotentes). O CLI não aplica sozinho: ver [db.migrations] em supabase/config.toml.
// 2. Cria os usuários de teste (os 5 de docs/usuarios-de-teste.sql + admin@farol.teste) e roda aquele script.
//    Senha: FAROL_SENHA_TESTE do ambiente ou uma gerada agora, mostrada UMA vez (só para contas criadas nesta execução).
// 3. Grava apps/api/.env e apps/web/.env.local com as chaves do Supabase LOCAL (não são segredos de produção),
//    sem sobrescrever arquivos que já existam.
// 4. Roda os seeds de dados: versão v1, OS do protótipo e cenários CR.
// Só fala com 127.0.0.1: nunca toca em projeto do Supabase na nuvem.
import { execSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const raiz = new URL("..", import.meta.url);
const caminho = (p) => new URL(p, raiz);

function falhar(msg) { console.error(`\n✖ ${msg}`); process.exit(1); }

// ── Supabase local no ar? ──
let status;
try {
  const saida = execSync("npx supabase status -o json", { cwd: raiz, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  status = JSON.parse(saida.slice(saida.indexOf("{")));
} catch {
  falhar("O Supabase local não está no ar. Abra o Docker Desktop e rode `npx supabase start` antes.");
}
const API_URL = status.API_URL;
const ANON = status.ANON_KEY;
const SERVICE = status.SERVICE_ROLE_KEY;
if (!API_URL?.includes("127.0.0.1") && !API_URL?.includes("localhost")) falhar(`API_URL inesperada (${API_URL}): este script é só para o Supabase local.`);
if (!ANON || !SERVICE) falhar("`supabase status` não devolveu ANON_KEY/SERVICE_ROLE_KEY.");

const projeto = (readFileSync(caminho("supabase/config.toml"), "utf8").match(/^project_id\s*=\s*"([^"]+)"/m) ?? [])[1];
const container = `supabase_db_${projeto}`;

/** Roda SQL no Postgres do container (psql do próprio container; para no primeiro erro). */
function psql(sql, rotulo) {
  const r = spawnSync("docker", ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q", "-t", "-A"], { input: sql, encoding: "utf8" });
  if (r.status !== 0) falhar(`${rotulo}:\n${r.stderr || r.stdout}`);
  return r.stdout.trim();
}

// ── 1. SQL na ordem do README ──
console.log("\n▶ Banco");
const jaTemSchema = psql("select to_regclass('public.ordens_servico') is not null;", "checar schema") === "t";
const arquivos = [
  ...(jaTemSchema ? [] : ["supabase/migrations/0001_init.sql"]),
  "supabase/seed.sql",
  "supabase/migrations/0002_solicitacoes.sql",
  "supabase/migrations/0003_endurecimento.sql",
  "supabase/migrations/0004_status_despacho.sql",
  "supabase/migrations/0005_pontuacao.sql",
  "supabase/migrations/0006_regras_edicao.sql",
  "supabase/migrations/0007_regras_minimo.sql",
];
if (jaTemSchema) console.log("  0001_init.sql já aplicada (schema existe) — pulada");
for (const f of arquivos) {
  psql(readFileSync(caminho(f), "utf8"), f);
  console.log(`  ✓ ${f}`);
}

// ── 2. Usuários de teste ──
console.log("\n▶ Usuários de teste");
const USUARIOS = ["atendente", "despachante", "supervisor", "campo", "chave", "admin"].map((u) => `${u}@farol.teste`);
const senha = process.env.FAROL_SENHA_TESTE || `Farol-${randomBytes(6).toString("base64url")}`;
const adminApi = (path, init = {}) =>
  fetch(`${API_URL}/auth/v1/admin${path}`, { ...init, headers: { apikey: SERVICE, Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json" } });

const lista = await (await adminApi("/users?per_page=1000")).json();
const existentes = new Set((lista.users ?? []).map((u) => u.email));
let criados = 0;
for (const email of USUARIOS) {
  if (existentes.has(email)) { console.log(`  = ${email} (já existia; senha mantida)`); continue; }
  const r = await adminApi("/users", { method: "POST", body: JSON.stringify({ email, password: senha, email_confirm: true }) });
  if (!r.ok) falhar(`Criar ${email}: ${r.status} ${await r.text()}`);
  criados++;
  console.log(`  + ${email}`);
}
psql(readFileSync(caminho("docs/usuarios-de-teste.sql"), "utf8"), "docs/usuarios-de-teste.sql");
psql(
  `insert into perfis (user_id, nome, perfil, todas_cidades)
     select id, 'Administrador Teste', 'Administrador', true from auth.users where email = 'admin@farol.teste'
   on conflict (user_id) do update set perfil = 'Administrador', todas_cidades = true;`,
  "perfil do administrador",
);
console.log("  ✓ perfis e cidades vinculados (docs/usuarios-de-teste.sql + Administrador)");

// ── 3. .env da API e do site ──
console.log("\n▶ Variáveis de ambiente");
const arquivosEnv = {
  "apps/api/.env": `# Supabase LOCAL (gerado por scripts/db-local.mjs) — chaves de desenvolvimento, não de produção\nSUPABASE_URL=${API_URL}\nSUPABASE_SERVICE_ROLE_KEY=${SERVICE}\nCORS_ORIGIN=http://localhost:3000\nPORT=3001\n`,
  "apps/web/.env.local": `# Supabase LOCAL (gerado por scripts/db-local.mjs)\nNEXT_PUBLIC_API_URL=http://localhost:3001\nNEXT_PUBLIC_SUPABASE_URL=${API_URL}\nNEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON}\n`,
};
for (const [f, conteudo] of Object.entries(arquivosEnv)) {
  if (existsSync(caminho(f))) { console.log(`  = ${f} já existe — mantido (confira se aponta para ${API_URL})`); continue; }
  writeFileSync(caminho(f), conteudo);
  console.log(`  ✓ ${f}`);
}

// ── 4. Dados demonstrativos ──
console.log("\n▶ Dados demonstrativos");
for (const s of ["seed", "seed:os", "seed:cr"]) {
  const r = spawnSync(`npm run ${s} --silent`, { cwd: raiz, encoding: "utf8", shell: true });
  if (r.status !== 0) falhar(`npm run ${s}:\n${r.stderr || r.stdout}`);
  console.log(`  ✓ npm run ${s}: ${r.stdout.trim().split("\n").pop()}`);
}

console.log(`\n✔ Pronto. Studio: ${status.STUDIO_URL ?? "http://127.0.0.1:54323"}`);
console.log("  Para subir API e site: npm run dev  (ou npm run dev:api e npm run dev:web)  →  http://localhost:3000");
if (criados) console.log(`  Login: ${USUARIOS.join(", ")}\n  Senha (só desta execução, não fica gravada): ${senha}`);
