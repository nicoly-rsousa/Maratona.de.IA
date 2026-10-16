// Smoke test do Farol (API + site). Uso: node scripts/smoke.mjs   (API em API_URL, padrão http://localhost:3001; site em WEB_URL, padrão http://localhost:3000)
// Não usa senhas: gera um link mágico pelo Admin API (service_role) e troca por sessão. Nunca imprime tokens, chaves nem senhas.
// NÃO publica versão de pontuação: só valida e salva rascunho (e, se já houver rascunho, regrava o mesmo conteúdo).
// Se o rascunho de BH não existia antes desta execução, o smoke CRIOU o dele e o descarta ao final (POST
// /pontuacao/descartar); se já existia (trabalho de alguém), nunca descarta — só o deixa regravado com o mesmo conteúdo.
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

// LGPD da OS (§12): Usuário Chave só configura pontuação, não precisa de endereço/UC/transformador completos (P-02/P-03).
const osId = fila[0]?.id;
await teste("fila BH (chave): endereço restrito, demais perfis veem o endereço", async () => {
  exige(fila.every((o) => typeof o.endereco === "string"), "despachante/atendente deveriam ver o endereço na fila");
  const r = await esperaStatus(tk.chave, "GET", "/os/fila?cidade=BH", 200);
  exige(r.json.every((o) => o.endereco === null), "chave recebeu endereço na fila"); return true;
});
let auditoriasAntes = 0;
await teste("detalhe OS (despachante): UC e endereço completos", async () => {
  exige(osId, "sem OS na fila para testar o detalhe");
  const { count } = await admin.from("auditoria").select("id", { count: "exact", head: true }).eq("entidade_id", osId).eq("acao", "os.detalhe");
  auditoriasAntes = count ?? 0;
  const r = await esperaStatus(tk.despachante, "GET", `/os/${osId}`, 200);
  exige(typeof r.json.os.endereco === "string" && r.json.os.endereco !== "Endereço restrito a este perfil", "despachante sem endereço completo");
  exige(!r.json.os.uc || !r.json.os.uc.includes("•"), "despachante recebeu UC mascarada"); return true;
});
await teste("detalhe OS (despachante): sucesso é auditado", async () => {
  const { count, error } = await admin.from("auditoria").select("id", { count: "exact", head: true }).eq("entidade_id", osId).eq("acao", "os.detalhe");
  exige(!error, error?.message); exige((count ?? 0) > auditoriasAntes, `auditoria não cresceu (${auditoriasAntes} → ${count})`); return true;
});
await teste("detalhe OS (chave): UC mascarada, endereço e transformador restritos", async () => {
  const r = await esperaStatus(tk.chave, "GET", `/os/${osId}`, 200);
  exige(r.json.os.endereco === "Endereço restrito a este perfil", `endereço vazou: ${r.json.os.endereco}`);
  exige(r.json.os.transformador === null, "transformador vazou para a chave");
  exige(!r.json.os.uc || r.json.os.uc.includes("•"), `UC não mascarada: ${r.json.os.uc}`); return true;
});

// Regra de UC por perfil (ucParaPerfil, apps/api/src/routes/os.ts): completa só para Despachante,
// Supervisor e Administrador; mascarada para Atendente, Equipe de campo e Usuário Chave. Os dois
// testes acima (despachante/chave) já cobrem 2 dos 6 perfis; os de baixo cobrem os outros 4 em /os/:id
// (Administrador entra mais abaixo, depois do login dele) e os de /os/duplicidade.
await teste("detalhe OS (atendente): UC mascarada", async () => {
  const r = await esperaStatus(tk.atendente, "GET", `/os/${osId}`, 200);
  exige(!r.json.os.uc || r.json.os.uc.includes("•"), `atendente recebeu UC completa: ${r.json.os.uc}`); return true;
});
await teste("detalhe OS (supervisor): UC completa", async () => {
  const r = await esperaStatus(tk.supervisor, "GET", `/os/${osId}`, 200);
  exige(!r.json.os.uc || !r.json.os.uc.includes("•"), "supervisor recebeu UC mascarada"); return true;
});
let osIdCampo = null;
await teste("fila BH (campo): captura uma OS da própria equipe p/ testar a UC", async () => {
  const r = await esperaStatus(tk.campo, "GET", "/os/fila?cidade=BH", 200);
  osIdCampo = r.json[0]?.id ?? null;
  return osIdCampo ? "OS da equipe encontrada" : "equipe de campo sem OS atribuída nesta fila; teste de UC será pulado";
});
await teste("detalhe OS (campo): UC mascarada", async () => {
  if (!osIdCampo) return "sem OS da própria equipe; pulado";
  const r = await esperaStatus(tk.campo, "GET", `/os/${osIdCampo}`, 200);
  exige(!r.json.os.uc || r.json.os.uc.includes("•"), `equipe de campo recebeu UC completa: ${r.json.os.uc}`); return true;
});

// Pontuação (sem publicar)
await teste("pontuação BH: despachante → 403", async () => { await esperaStatus(tk.despachante, "GET", "/pontuacao/versoes?escopo=BH", 403); return true; });
await teste("pontuação global: usuário chave → 403", async () => { await esperaStatus(tk.chave, "GET", "/pontuacao/versoes?escopo=global", 403); return true; });
await teste("publicar: supervisor → 403 (só aprova)", async () => {
  await esperaStatus(tk.supervisor, "POST", "/pontuacao/publicar", 403, { rascunhoId: "00000000-0000-4000-8000-000000000000", etag: 1, justificativa: "smoke", vigenciaInicio: new Date().toISOString(), modo: "novas" }); return true;
});
let estado;
let rascunhoPreexistenteBH = false;
await teste("pontuação BH: chave lê versões", async () => {
  estado = (await esperaStatus(tk.chave, "GET", "/pontuacao/versoes?escopo=BH", 200)).json;
  rascunhoPreexistenteBH = !!estado.rascunho; // decide, no final, se o smoke pode descartar o que gravou
  return `publicada v${estado.publicada?.numero ?? "—"}, herdada v${estado.herdada?.numero ?? "—"}, rascunho ${estado.rascunho ? "sim" : "não"}`;
});
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
let rascunhoBH = null; // { id, etag } do rascunho como ficou depois do salvar abaixo — para o descarte no final
await teste("salvar rascunho BH (200)", async () => {
  const r = await esperaStatus(tk.chave, "PUT", "/pontuacao/rascunho?escopo=BH", 200, { conteudo: base(), etag: estado.rascunho?.etag ?? null });
  exige(r.json.rascunho, "sem rascunho no retorno"); rascunhoBH = r.json.rascunho; return `rascunho v${r.json.rascunho.numero}`;
});
await teste("rascunho com etag velho → 409", async () => { await esperaStatus(tk.chave, "PUT", "/pontuacao/rascunho?escopo=BH", 409, { conteudo: base(), etag: 999999 }); return true; });

// Regras de precedência (camada A). NUNCA grava: todo PUT aqui é recusado antes de qualquer escrita
// (403 na API, 400 na validação/corpo ou 409 no banco). Os PUTs de Administrador mandam as regras atuais SEM mudança:
// mesmo que a trava de versão falhasse, o banco recusaria com "nenhuma alteração".
await teste("login Administrador (perfil do banco)", async () => {
  const { data: adms, error } = await admin.from("perfis").select("user_id").eq("perfil", "Administrador");
  exige(!error && adms?.length, "nenhum perfil Administrador");
  let email = null;
  for (const a of adms) { const { data: u } = await admin.auth.admin.getUserById(a.user_id); if (u?.user?.email) { email = u.user.email; if (email.endsWith("@farol.teste")) break; } }
  exige(email, "Administrador sem e-mail"); tk.admin = await token(email); return true; // e-mail não é impresso
});
await teste("detalhe OS (admin): UC completa", async () => {
  const r = await esperaStatus(tk.admin, "GET", `/os/${osId}`, 200);
  exige(!r.json.os.uc || !r.json.os.uc.includes("•"), "administrador recebeu UC mascarada"); return true;
});

// /os/duplicidade exige a permissão "nova" (só Administrador e Atendente a têm hoje — Despachante,
// Supervisor, Equipe de campo e Usuário Chave levam 403 antes de qualquer lógica de UC rodar).
// Por isso só dá pra provar a máscara de UC nesta rota com atendente (mascarada) e admin (completa).
let osComUC = null;
await teste("busca uma OS aberta com UC em BH (dentro da janela de duplicidade) p/ testar", async () => {
  // sugerirDuplicidade só considera OS abertas dentro de DUP_JANELA_H (padrão 24h) — sem esse filtro,
  // uma OS de seed mais antiga nunca aparece como candidata, mesmo com UC igual.
  const desde = new Date(Date.now() - 24 * 3_600_000).toISOString();
  const { data, error } = await admin.from("ordens_servico").select("id, uc")
    .eq("cidade_id", "BH").not("status", "in", "(Concluída,Cancelada)").not("uc", "is", null).gte("aberta_em", desde).limit(1);
  exige(!error, error?.message);
  osComUC = data?.[0] ?? null;
  return osComUC ? "OS com UC encontrada" : "nenhuma OS aberta em BH com UC dentro da janela; testes de UC em duplicidade serão pulados";
});
await teste("duplicidade BH (atendente): mesma UC mascarada", async () => {
  if (!osComUC) return "sem OS com UC; pulado";
  const r = await esperaStatus(tk.atendente, "GET", `/os/duplicidade?cidade=BH&uc=${encodeURIComponent(osComUC.uc)}`, 200);
  const achada = r.json.find((s) => s.id === osComUC.id);
  exige(achada && achada.motivos.includes("mesma_uc"), "não achou a OS esperada por mesma_uc");
  exige(achada.uc !== osComUC.uc && (achada.uc === null || achada.uc.includes("•")), `UC não mascarada para atendente: ${achada.uc}`);
  return true;
});
await teste("duplicidade BH (admin): mesma UC completa", async () => {
  if (!osComUC) return "sem OS com UC; pulado";
  const r = await esperaStatus(tk.admin, "GET", `/os/duplicidade?cidade=BH&uc=${encodeURIComponent(osComUC.uc)}`, 200);
  const achada = r.json.find((s) => s.id === osComUC.id);
  exige(achada && achada.motivos.includes("mesma_uc"), "não achou a OS esperada por mesma_uc");
  exige(achada.uc === osComUC.uc, `UC mascarada para administrador: ${achada.uc}`);
  return true;
});
for (const p of ["despachante", "supervisor", "campo", "chave"]) {
  await teste(`duplicidade BH (${p}) → 403 (sem permissão "nova")`, async () => {
    await esperaStatus(tk[p], "GET", "/os/duplicidade?cidade=BH&uc=00000001", 403); return true;
  });
}
let regrasAtual;
await teste("regras: admin lê (editável)", async () => {
  regrasAtual = (await esperaStatus(tk.admin, "GET", "/regras", 200)).json;
  exige(regrasAtual.editavel === true, "admin sem edição"); return `v${regrasAtual.versao}, ${regrasAtual.regras.length} regra(s)`;
});
const corpoAtual = () => regrasAtual.regras.map((r) => ({ id: r.id, nome: r.nome, ativa: r.ativa, nivel: r.nivel, prioridadeMinima: r.prioridadeMinima, cond: r.condicoes.map((c) => ({ criterio: c.criterio, opcoes: c.opcoes })) }));
await teste("regras: supervisor lê só leitura", async () => { const r = await esperaStatus(tk.supervisor, "GET", "/regras", 200); exige(r.json.editavel === false, "supervisor editável"); return true; });
await teste("regras: usuário chave → 403", async () => { await esperaStatus(tk.chave, "GET", "/regras", 403); return true; });
await teste("regras: equipe de campo → 403", async () => { await esperaStatus(tk.campo, "GET", "/regras", 403); return true; });
await teste("regras: OS abertas carimbadas na versão em vigor", async () => {
  const { data, error } = await admin.from("ordens_servico").select("regras_versao").not("status", "in", "(Concluída,Cancelada)");
  exige(!error, error?.message); const fora = data.filter((o) => o.regras_versao == null || o.regras_versao < regrasAtual.versao).length;
  exige(fora === 0, `${fora} OS sem carimbo ou em versão antiga`); return `${data.length} OS abertas em v${regrasAtual.versao}`;
});
await teste("regras: prever sem mudança → 0 OS mudam", async () => {
  const r = await esperaStatus(tk.admin, "POST", "/regras/prever", 200, { regras: corpoAtual() });
  exige(r.json.erros.length === 0, `erros: ${r.json.erros.join(" | ")}`); exige(r.json.impacto.mudaram === 0, `${r.json.impacto.mudaram} mudariam`);
  return `${r.json.impacto.total} OS avaliadas, ${r.json.alertas.length} alerta(s)`;
});
await teste("regras: prever por não-Administrador → 403", async () => { await esperaStatus(tk.supervisor, "POST", "/regras/prever", 403, { regras: corpoAtual() }); return true; });
await teste("gravar regras: não-Administrador → 403", async () => {
  await esperaStatus(tk.supervisor, "PUT", "/regras", 403, { regras: corpoAtual(), versaoBase: regrasAtual.versao, justificativa: "smoke" }); return true;
});
await teste("gravar regras: versão base antiga → 409", async () => {
  const r = await esperaStatus(tk.admin, "PUT", "/regras", 409, { regras: corpoAtual(), versaoBase: regrasAtual.versao + 1000, justificativa: "smoke (nunca grava)" });
  return r.json.regra ?? "";
});
await teste("gravar regras: justificativa vazia → 400", async () => {
  await esperaStatus(tk.admin, "PUT", "/regras", 400, { regras: corpoAtual(), versaoBase: regrasAtual.versao, justificativa: "   " }); return true;
});
await teste("gravar regras: conjunto vazio → 400", async () => {
  const r = await esperaStatus(tk.admin, "PUT", "/regras", 400, { regras: [], versaoBase: regrasAtual.versao, justificativa: "smoke (nunca grava)" });
  exige(/ao menos uma regra/i.test(r.json.erro), r.json.erro); return r.json.regra ?? "";
});
await teste("regras: nenhuma versão nova foi gravada", async () => {
  const r = await esperaStatus(tk.admin, "GET", "/regras", 200);
  exige(r.json.versao === regrasAtual.versao, `versão mudou: v${regrasAtual.versao} → v${r.json.versao}`); return `continua v${r.json.versao}`;
});

// Limpeza do rascunho de pontuação de BH: só descarta o que o PRÓPRIO smoke criou nesta execução
// (rascunho que já existia antes continua intocado, para não apagar trabalho de alguém).
await teste("pontuação BH: descarta o rascunho criado pelo smoke (se foi o smoke que criou)", async () => {
  if (rascunhoPreexistenteBH) return "rascunho já existia antes; não mexido";
  exige(rascunhoBH, "sem rascunho para descartar, mas o smoke deveria ter criado um");
  await esperaStatus(tk.chave, "POST", "/pontuacao/descartar", 200, { rascunhoId: rascunhoBH.id, etag: rascunhoBH.etag });
  return `descartado v${rascunhoBH.numero}`;
});
await teste("pontuação BH: sem rascunho pendente depois do smoke", async () => {
  if (rascunhoPreexistenteBH) return "havia rascunho antes do smoke; verificação não se aplica";
  const r = await esperaStatus(tk.chave, "GET", "/pontuacao/versoes?escopo=BH", 200);
  exige(!r.json.rascunho, `sobrou rascunho v${r.json.rascunho?.numero}`); return true;
});

// Site
await teste("site / responde", async () => { const r = await fetch(WEB, { redirect: "manual" }); exige(r.status < 500, `HTTP ${r.status}`); return `HTTP ${r.status}`; });

const larg = Math.max(...linhas.map((l) => l[0].length));
for (const [n, s, d] of linhas) console.log(`${s === "OK" ? "OK   " : "FALHA"}  ${n.padEnd(larg)}  ${d}`);
const falhas = linhas.filter((l) => l[1] === "FALHA").length;
console.log(`\n${linhas.length - falhas}/${linhas.length} OK`);
process.exit(falhas ? 1 : 0);
