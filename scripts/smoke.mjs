// Smoke test do Farol (API + site). Uso: node scripts/smoke.mjs   (API em API_URL, padrão http://localhost:3001; site em WEB_URL, padrão http://localhost:3000)
// Não usa senhas: gera um link mágico pelo Admin API (service_role) e troca por sessão. Nunca imprime tokens, chaves nem senhas.
// NÃO publica versão de pontuação: só valida e salva rascunho (e, se já houver rascunho, regrava o mesmo conteúdo).
import { readFileSync } from "node:fs";
import { parseEnv } from "node:util";
import { createClient } from "@supabase/supabase-js";

const lerEnv = (f) => parseEnv(readFileSync(f, "utf8")); // mesmo parser do --env-file (aspas, comentários inline)
const apiEnv = lerEnv("apps/api/.env");
const webEnv = lerEnv("apps/web/.env.local");
const API = process.env.API_URL ?? "http://127.0.0.1:3001"; // 127.0.0.1: "localhost" pode resolver para IPv6 e cair em outro processo
const WEB = process.env.WEB_URL ?? "http://localhost:3000";
const admin = createClient(apiEnv.SUPABASE_URL, apiEnv.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const linhas = [];
const teste = async (nome, fn) => {
  try { const r = await fn(); linhas.push([nome, r === false ? "FALHA" : "OK", typeof r === "string" ? r : ""]); }
  catch (e) { linhas.push([nome, "FALHA", String(e.message ?? e).slice(0, 160)]); }
};
const exige = (c, msg) => { if (!c) throw new Error(msg); return true; };

async function token(email) {
  const { data, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) throw new Error(`generateLink ${email}: ${error.message}`);
  const anon = createClient(webEnv.NEXT_PUBLIC_SUPABASE_URL, webEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: s, error: e2 } = await anon.auth.verifyOtp({ token_hash: data.properties.hashed_token, type: "magiclink" });
  if (e2 || !s.session) throw new Error(`verifyOtp ${email}: ${e2?.message}`);
  return s.session.access_token;
}
const req = async (tk, metodo, caminho, corpo) => {
  const r = await fetch(API + caminho, { method: metodo, headers: { ...(tk ? { authorization: `Bearer ${tk}` } : {}), ...(corpo ? { "content-type": "application/json" } : {}) }, body: corpo ? JSON.stringify(corpo) : undefined });
  let json = null; try { json = await r.json(); } catch { /* sem corpo */ }
  return { status: r.status, json };
};
const esperaStatus = async (tk, m, c, st, corpo) => { const r = await req(tk, m, c, corpo); exige(r.status === st, `${m} ${c}: esperava ${st}, veio ${r.status}${r.json?.erro ? ` (${r.json.erro})` : ""}`); return r; };

const tk = {};
for (const p of ["atendente", "despachante", "supervisor", "campo", "chave"]) {
  await teste(`login (link mágico) ${p}`, async () => { tk[p] = await token(`${p}@farol.teste`); return true; });
}

await teste("API /health", async () => { await esperaStatus(null, "GET", "/health", 200); return true; });
await teste("sem token → 401", async () => { await esperaStatus(null, "GET", "/os/fila?cidade=BH", 401); return true; });
const perfis = { atendente: "Atendente", despachante: "Despachante", supervisor: "Supervisor", campo: "Equipe de campo", chave: "Usuário Chave" };
for (const [p, perfil] of Object.entries(perfis)) {
  await teste(`/me ${p} = ${perfil}`, async () => { const r = await esperaStatus(tk[p], "GET", "/me", 200); exige(r.json.perfil === perfil, `perfil ${r.json.perfil}`); return true; });
}

let fila = [];
await teste("fila BH (atendente) traz as 9 CR", async () => {
  const r = await esperaStatus(tk.atendente, "GET", "/os/fila?cidade=BH", 200);
  fila = r.json; const cr = fila.filter((o) => /^CR-0\d [A-C] —/.test(o.endereco));
  exige(cr.length === 9, `${cr.length} CR na fila`); return `${fila.length} OS na fila`;
});
const pos = (pref) => fila.find((o) => o.endereco?.startsWith(pref))?.posicao;
await teste("CR-01: B (hospital) antes de A", async () => exige(pos("CR-01 B") < pos("CR-01 A"), `B=${pos("CR-01 B")} A=${pos("CR-01 A")}`));
await teste("CR-02: A (hospital) antes de B", async () => exige(pos("CR-02 A") < pos("CR-02 B"), `A=${pos("CR-02 A")} B=${pos("CR-02 B")}`));
await teste("CR-04: A (queda) antes de B", async () => exige(pos("CR-04 A") < pos("CR-04 B"), `A=${pos("CR-04 A")} B=${pos("CR-04 B")}`));
await teste("CR-03: C (prazo 10 h) antes de A e B", async () => exige(pos("CR-03 C") < pos("CR-03 A") && pos("CR-03 C") < pos("CR-03 B"), "ordem"));
await teste("atendente fila CT → 403", async () => { await esperaStatus(tk.atendente, "GET", "/os/fila?cidade=CT", 403); return true; });
await teste("atendente fila * → 403", async () => { await esperaStatus(tk.atendente, "GET", "/os/fila?cidade=*", 403); return true; });
await teste("mapa BH (atendente) 200, sem endereço", async () => { const r = await esperaStatus(tk.atendente, "GET", "/mapa?cidade=BH", 200); return JSON.stringify(r.json).includes("endereco") ? exige(false, "mapa vaza endereço") : true; });
await teste("mapa CT (atendente) → 403", async () => { await esperaStatus(tk.atendente, "GET", "/mapa?cidade=CT", 403); return true; });
await teste("equipe de campo vê só as próprias OS", async () => {
  const r = await esperaStatus(tk.campo, "GET", "/os/fila?cidade=BH", 200);
  exige(r.json.length <= fila.length, "campo vê mais que a fila"); return `${r.json.length} de ${fila.length}`;
});
await teste("supervisor fila * (todas as cidades) 200", async () => { await esperaStatus(tk.supervisor, "GET", "/os/fila?cidade=*", 200); return true; });

// Pontuação (sem publicar)
await teste("pontuação BH: despachante → 403", async () => { await esperaStatus(tk.despachante, "GET", "/pontuacao/versoes?escopo=BH", 403); return true; });
await teste("pontuação global: usuário chave → 403", async () => { await esperaStatus(tk.chave, "GET", "/pontuacao/versoes?escopo=global", 403); return true; });
await teste("publicar: supervisor → 403 (só aprova)", async () => {
  await esperaStatus(tk.supervisor, "POST", "/pontuacao/publicar", 403, { rascunhoId: "00000000-0000-4000-8000-000000000000", etag: 1, justificativa: "smoke", vigenciaInicio: new Date().toISOString(), modo: "novas" }); return true;
});
let estado;
await teste("pontuação BH: chave lê versões", async () => { estado = (await esperaStatus(tk.chave, "GET", "/pontuacao/versoes?escopo=BH", 200)).json; return `publicada v${estado.publicada?.numero ?? "—"}, herdada v${estado.herdada?.numero ?? "—"}, rascunho ${estado.rascunho ? "sim" : "não"}`; });
const base = () => estado?.rascunho?.conteudo ?? estado?.publicada?.conteudo ?? estado?.herdada?.conteudo;
await teste("validar conteúdo vigente: sem erros", async () => {
  const r = await esperaStatus(tk.chave, "POST", "/pontuacao/validar?escopo=BH", 200, { conteudo: base() });
  exige(r.json.erros.length === 0, `erros: ${r.json.erros.join(" | ")}`); return `${r.json.alertas.length} alerta(s)`;
});
await teste("validar com pontos=null bloqueia", async () => {
  const c = structuredClone(base()); c.criterios[0].opcoes[0].pontos = null;
  const r = await esperaStatus(tk.chave, "POST", "/pontuacao/validar?escopo=BH", 200, { conteudo: c });
  exige(r.json.erros.length > 0, "pontos=null não gerou erro"); return true;
});
await teste("salvar rascunho BH (200)", async () => {
  const r = await esperaStatus(tk.chave, "PUT", "/pontuacao/rascunho?escopo=BH", 200, { conteudo: base(), etag: estado.rascunho?.etag ?? null });
  exige(r.json.rascunho, "sem rascunho no retorno"); return `rascunho v${r.json.rascunho.numero}`;
});
await teste("rascunho com etag velho → 409", async () => { await esperaStatus(tk.chave, "PUT", "/pontuacao/rascunho?escopo=BH", 409, { conteudo: base(), etag: 999999 }); return true; });

// Site
await teste("site / responde", async () => { const r = await fetch(WEB, { redirect: "manual" }); exige(r.status < 500, `HTTP ${r.status}`); return `HTTP ${r.status}`; });

const larg = Math.max(...linhas.map((l) => l[0].length));
for (const [n, s, d] of linhas) console.log(`${s === "OK" ? "OK   " : "FALHA"}  ${n.padEnd(larg)}  ${d}`);
const falhas = linhas.filter((l) => l[1] === "FALHA").length;
console.log(`\n${linhas.length - falhas}/${linhas.length} OK`);
process.exit(falhas ? 1 : 0);
