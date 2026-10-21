// Cadastro de OS por arquivo: LOGIN REAL no Supabase LOCAL, banco com as migrações até a 0016 e a versão de pontuação (npm run seed).
// Rode: npm run test:integracao (carrega .env.docker). Recusa qualquer destino que não seja 127.0.0.1/localhost:54322.
// A prévia usa o arquivo REAL (somente leitura). A gravação usa linhas sintéticas "ITEST-…": ao final as OS ficam Canceladas e as
// cidades criadas ficam inativas (resultados de prioridade e solicitações são imutáveis, então não há como apagá-los).
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { FastifyInstance } from "fastify";

const dbUrl = process.env.DATABASE_URL ?? "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON = process.env.SUPABASE_ANON_KEY ?? "";
const configurado = !!(dbUrl && SERVICE && ANON);

const sufixo = Date.now().toString(36).toUpperCase();
const SENHA = `Senha-${sufixo}-Teste!`;
// Usuários FIXOS e reaproveitados (senha nova a cada execução): quem cria solicitações não pode ser apagado (solicitacoes é imutável).
const email = (n: string) => `teste-importacao-${n}@farol-teste.local`;
const MUN = `ITEST ${sufixo} MUNICIPIO`;
const MUN2 = `ITEST ${sufixo} OUTRO / DISTRITO`;
const num = (n: string) => `ITEST-${sufixo}-${n}`;

const ARQUIVO = path.resolve(import.meta.dirname, "../../../../docs/dados/OS manutenção pendente.xlsx");

const CAB = ["OSNumero", "CodSetor", "CodPrioridade", "DataDeadline", "Quantidade clientes", "Localidade", "Logradouro", "Bairro", "Complemento de Localização",
  "COORDENADA UTM X", "COORDENADA UTM Y", "DescEsquema", "Familias"];
type L = Partial<Record<string, string>>;
const lin = (n: number, o: L) => ({ linha: n, valores: CAB.map((c) => o[c] ?? "") });
const tabela = (...ls: L[]) => ({ cabecalho: CAB, linhas: ls.map((o, i) => lin(i + 2, o)) });

let app: FastifyInstance;
let admin: SupabaseClient;
const tokens: Record<string, string> = {};

const post = (url: string, perfil: string | null, tabelaJson: unknown) =>
  app.inject({ method: "POST", url, headers: perfil ? { authorization: `Bearer ${tokens[perfil]!}` } : {}, payload: { tabela: tabelaJson } as object });
const get = (url: string, perfil: string) => app.inject({ method: "GET", url, headers: { authorization: `Bearer ${tokens[perfil]!}` } });

describe.skipIf(!configurado)("cadastro de OS no formato OS manutenção pendente (login real, banco local)", () => {
  beforeAll(async () => {
    const u = new URL(dbUrl);
    if (!["127.0.0.1", "localhost"].includes(u.hostname) || u.port !== "54322") throw new Error(`Integração recusada: destino não é o banco local (${u.hostname}:${u.port}).`);
    const BASE = `http://${u.hostname}:54321`;
    process.env.SUPABASE_URL = BASE;
    admin = createClient(BASE, SERVICE, { auth: { persistSession: false } });

    for (const [nome, perfil, todas] of [["administrador", "Administrador", true], ["atendente", "Atendente", false]] as const) {
      const { data: lista } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const existente = lista?.users.find((x) => x.email === email(nome));
      let id: string;
      if (existente) {
        const { error } = await admin.auth.admin.updateUserById(existente.id, { password: SENHA, email_confirm: true, ban_duration: "none" });
        if (error) throw new Error(`updateUser ${nome}: ${error.message}`);
        id = existente.id;
      } else {
        const { data, error } = await admin.auth.admin.createUser({ email: email(nome), password: SENHA, email_confirm: true });
        if (error) throw new Error(`createUser ${nome}: ${error.message}`);
        id = data.user.id;
      }
      const { error: e2 } = await admin.from("perfis").upsert({ user_id: id, nome: `teste ${nome}`, perfil, todas_cidades: todas }, { onConflict: "user_id" });
      if (e2) throw new Error(`perfis ${nome}: ${e2.message}`);
      const cli = createClient(BASE, ANON, { auth: { persistSession: false } });
      const { data: s, error: e3 } = await cli.auth.signInWithPassword({ email: email(nome), password: SENHA });
      if (e3 || !s.session) throw new Error(`login ${nome}: ${e3?.message}`);
      tokens[perfil] = s.session.access_token;
    }
    const { criarApp } = await import("../app.js");
    app = await criarApp({ logger: false });
  });

  afterAll(async () => {
    await app?.close();
    // inerte: OS canceladas e cidades inativas (os registros imutáveis ficam)
    await admin.from("ordens_servico").update({ status: "Cancelada" }).like("numero_origem", `ITEST-${sufixo}-%`);
    await admin.from("cidades").update({ ativa: false }).like("municipio_origem", `ITEST ${sufixo} %`);
    // os usuários fixos ficam (apagar falharia: solicitacoes.criado_por é imutável); bloqueados até a próxima execução
    for (const nome of ["administrador", "atendente"]) {
      const { data: lista } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
      const u = lista?.users.find((x) => x.email === email(nome));
      if (u) await admin.auth.admin.updateUserById(u.id, { ban_duration: "876000h" });
    }
  });

  it("sem login 401; Atendente (sem escopo global) 403 nas duas rotas, sem gravar nada", async () => {
    for (const url of ["/os/importar-pendentes/preview", "/os/importar-pendentes/confirmar"]) {
      expect((await post(url, null, tabela({ OSNumero: num("A"), Localidade: `${MUN} 1-1` }))).statusCode).toBe(401);
      expect((await post(url, "Atendente", tabela({ OSNumero: num("A"), Localidade: `${MUN} 1-1` }))).statusCode).toBe(403);
    }
    const { count } = await admin.from("ordens_servico").select("*", { count: "exact", head: true }).like("numero_origem", `ITEST-${sufixo}-%`);
    expect(count).toBe(0);
  });

  const comArquivoReal = existsSync(ARQUIVO) ? it : it.skip;
  comArquivoReal("prévia com o ARQUIVO REAL (somente leitura): 4.513 entram, 0 rejeitadas, 92 municípios; nada é gravado", async () => {
    const ExcelJS = createRequire(import.meta.url)("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(ARQUIVO);
    const ws = wb.worksheets[0];
    const txt = (v: unknown): string | number | null => {
      if (v === null || v === undefined) return null;
      if (typeof v === "object") { const o = v as { richText?: { text: string }[]; result?: unknown; text?: string }; return o.richText ? o.richText.map((p) => p.text).join("") : ((o.result ?? o.text ?? null) as string | number | null); }
      return v as string | number;
    };
    const pos: Record<string, number> = {};
    ws.getRow(1).eachCell({ includeEmpty: true }, (c: { value: unknown }, i: number) => { const n = String(txt(c.value) ?? "").trim(); if (!(n in pos)) pos[n] = i; });
    // o navegador projeta SÓ as colunas reconhecidas: as outras (inclusive as pessoais) nem saem da máquina
    const cabecalho = ["OSNumero", "CodSetor", "CodPrioridade", "DataDeadline", "Quantidade clientes", "Localidade", "Logradouro", "Bairro", "Complemento de Localização",
      "COORDENADA UTM X", "COORDENADA UTM Y", "LATITUDE (Y) - SIRGAS 2000", "LONGITUDE (X) - SIRGAS 2000", "DescEsquema", "Familias"];
    const linhas = [];
    for (let r = 2; r <= ws.rowCount; r++) {
      const valores = cabecalho.map((c) => { const v = txt(ws.getRow(r).getCell(pos[c]!).value); return v === null ? null : typeof v === "number" ? v : String(v); });
      if (valores.some((v) => v !== null && String(v).trim() !== "")) linhas.push({ linha: r, valores });
    }
    const corpo = JSON.stringify({ tabela: { cabecalho, linhas } });
    console.log(`[medição] corpo da prévia (só 15 colunas, ${linhas.length} linhas): ${(corpo.length / 1024).toFixed(0)} kB`);

    const antes = (await admin.from("ordens_servico").select("*", { count: "exact", head: true })).count;
    const t0 = performance.now();
    // o auth local pode estourar o tempo sob carga e a API devolve 401 em qualquer falha dele: tenta de novo (no máximo 3 vezes) SÓ nesse caso
    let r = await app.inject({ method: "POST", url: "/os/importar-pendentes/preview", headers: { authorization: `Bearer ${tokens.Administrador!}`, "content-type": "application/json" }, payload: corpo });
    for (let t = 1; t < 3 && r.statusCode === 401; t++) {
      console.log(`[aviso] prévia devolveu 401 (auth local lento sob carga); tentativa ${t + 1}`);
      r = await app.inject({ method: "POST", url: "/os/importar-pendentes/preview", headers: { authorization: `Bearer ${tokens.Administrador!}`, "content-type": "application/json" }, payload: corpo });
    }
    console.log(`[medição] prévia do arquivo real: ${Math.round(performance.now() - t0)} ms, resposta ${(r.rawPayload.length / 1024).toFixed(0)} kB`);
    expect(r.statusCode, r.body.slice(0, 300)).toBe(200);
    const j = r.json();
    expect(j).toMatchObject({ totalLinhas: 4513, entram: 4513, totalRejeitadas: 0, comAviso: 0, semCoordenada: 0, tamanhoLote: 200 });
    expect(j.origemEndereco).toEqual({ informado: 0, derivado_poste: 4513, nao_informado: 0 });
    expect(j.vazios.Logradouro).toBe(4513);
    expect(j.vazios.Bairro).toBe(4513);
    expect(j.vazios.DataDeadline).toBe(0);
    expect(j.cidades.municipios).toBe(92);
    expect(j.cidades.novas + j.cidades.existentes).toBe(92);
    expect(j.entramLinhas).toHaveLength(4513);
    const depois = (await admin.from("ordens_servico").select("*", { count: "exact", head: true })).count;
    expect(depois).toBe(antes); // prévia não grava
  }, 120_000);

  let ordem: Record<string, any>[] = []; // eslint-disable-line @typescript-eslint/no-explicit-any
  it("confirmar: cria as cidades e as OS no banco real, com prioridade do motor, endereço NOT NULL e campos do formato", async () => {
    const lote = tabela(
      { OSNumero: num("A"), CodSetor: "LPD-1", CodPrioridade: "ALTA", DataDeadline: "04/01/2026", "Quantidade clientes": "12", Localidade: `${MUN} 48-160`, "Complemento de Localização": "48-160", "COORDENADA UTM X": "700000", "COORDENADA UTM Y": "7700000", DescEsquema: "Poda", Familias: "REDE" },
      { OSNumero: num("B  001/2026"), Localidade: `${MUN} 1-1` },
      { OSNumero: num("C"), CodSetor: "ALIMENTADOR-QUE-NAO-EXISTE", Localidade: `${MUN2} 9-9`, "COORDENADA UTM X": "700000" /* só X: aviso, sem coordenada */ },
    );
    const r = await post("/os/importar-pendentes/confirmar", "Administrador", lote);
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ recebidas: 3, criadas: 3, jaExistentes: 0, cidadesCriadas: 2, comAviso: 1, rejeitadas: [] });

    const { data: cidades } = await admin.from("cidades").select("id, nome, ativa").in("municipio_origem", [MUN, MUN2]);
    expect(cidades).toHaveLength(2);
    for (const c of cidades!) { expect(c.id).toMatch(/^[A-Z]{2,5}$/); expect(c.ativa).toBe(true); }

    const { data } = await admin.from("ordens_servico").select("*").like("numero_origem", `ITEST-${sufixo}-%`).order("numero_origem");
    ordem = data!;
    expect(ordem).toHaveLength(3);
    const [a, b, c] = ordem as [Record<string, any>, Record<string, any>, Record<string, any>]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(a).toMatchObject({
      endereco: `Poste 48-160 — ${MUN}`, origem_endereco: "derivado_poste", poste_codigo: "48-160", prioridade_legada: "ALTA", clientes: 12,
      tipo_servico: "Poda", familia_ativo: "REDE", circuito: "LPD-1", circuito_origem: "importado", municipio: MUN, origem_geo: "convertido_utm",
      status: "Aguardando despacho", tipo: "Corretiva", fatos: {},
    });
    expect(a.geom).not.toBeNull();
    expect(new Date(a.prazo_origem).toISOString()).toBe("2026-01-04T03:00:00.000Z");
    expect(a.prazo_limite).toBeNull(); // o prazo da planilha NÃO vira prazo-limite do Farol
    expect(a.numero).toMatch(/^[A-Z]{2,5}-\d{4}-\d{4}$/); // numeração do Farol por cidade
    expect(b).toMatchObject({ endereco: `Endereço não informado — ${MUN}`, origem_endereco: "nao_informado", clientes: null, prazo_origem: null, circuito: null, circuito_origem: null, lat: null, geom: null, status: "Em triagem", origem_geo: "desconhecido" });
    expect(c).toMatchObject({ circuito: "ALIMENTADOR-QUE-NAO-EXISTE", circuito_origem: "nao_identificado", lat: null, status: "Em triagem" });
    // prioridade do motor: critérios de risco sem resposta = "Desconhecido" (58 pontos), não zero
    for (const o of ordem) expect(o.pontos).toBe(58);

    const { data: res } = await admin.from("resultados_prioridade").select("os_id, itens, motivo_calculo").in("os_id", ordem.map((o) => o.id));
    expect(res).toHaveLength(3);
    const prazo = (res![0]!.itens as { criterio: string; opcoes: string[] }[]).find((i) => i.criterio === "Prazo-limite (auto)")!;
    expect(prazo.opcoes).toEqual([]); // não afirma "Sem prazo"
    expect(res!.every((x) => x.motivo_calculo === "Abertura")).toBe(true);
    const { count: sol } = await admin.from("solicitacoes").select("*", { count: "exact", head: true }).in("os_id", ordem.map((o) => o.id));
    expect(sol).toBe(3);
  }, 60_000);

  it("IDEMPOTENTE: reenviar o mesmo lote não duplica OS, cidades nem numeração", async () => {
    const lote = tabela(
      { OSNumero: num("A"), Localidade: `${MUN} 48-160` },
      { OSNumero: num("B  001/2026"), Localidade: `${MUN} 1-1` },
      { OSNumero: num("C"), Localidade: `${MUN2} 9-9` },
    );
    const r = await post("/os/importar-pendentes/confirmar", "Administrador", lote);
    expect(r.json()).toMatchObject({ recebidas: 3, criadas: 0, jaExistentes: 3, cidadesCriadas: 0 });
    const { count } = await admin.from("ordens_servico").select("*", { count: "exact", head: true }).like("numero_origem", `ITEST-${sufixo}-%`);
    expect(count).toBe(3);
    const { data } = await admin.from("ordens_servico").select("numero").like("numero_origem", `ITEST-${sufixo}-%`).order("numero_origem");
    expect(data!.map((x) => x.numero)).toEqual(ordem.map((x) => x.numero));
  });

  it("a rotina de reclassificação de 60 s NÃO transforma o prazo desconhecido em 'Sem prazo' (não gera resultado novo)", async () => {
    const { reclassificarAbertas } = await import("../jobs/reclassificar.js");
    await reclassificarAbertas();
    const { data: res } = await admin.from("resultados_prioridade").select("os_id, itens").in("os_id", ordem.map((o) => o.id));
    expect(res).toHaveLength(3); // nenhum resultado novo: nada mudou
    const { data: os } = await admin.from("ordens_servico").select("pontos, codigo").in("id", ordem.map((o) => o.id));
    expect(os!.every((o) => o.pontos === 58)).toBe(true);
  }, 120_000);

  it("a OS importada aparece na API normal: lista de cidades do Administrador, fila da cidade e detalhe", async () => {
    const cidade = ordem[0]!.cidade_id as string;
    const cids = (await get("/cidades", "Administrador")).json() as { id: string; nome: string }[];
    expect(cids.map((c) => c.id)).toContain(cidade);
    const fila = await get(`/os/fila?cidade=${cidade}`, "Administrador");
    expect(fila.statusCode).toBe(200);
    expect(JSON.stringify(fila.json())).toContain(ordem[0]!.numero);
    const det = await get(`/os/${ordem[0]!.id}`, "Administrador");
    expect(det.statusCode).toBe(200);
  });


  // Medição opcional (cria 200 OS que ficam Canceladas): FAROL_MEDIR_LOTE=1 npm run test:integracao
  (process.env.FAROL_MEDIR_LOTE ? it : it.skip)("MEDIÇÃO: um lote de 200 linhas (o tamanho configurado) grava em quanto tempo?", async () => {
    const lote = { cabecalho: CAB, linhas: Array.from({ length: 200 }, (_, i) => lin(i + 2, {
      OSNumero: num(`LOTE-${i}`), CodSetor: "LPD-1", CodPrioridade: "ALTA", DataDeadline: "04/01/2026", "Quantidade clientes": "5", Localidade: `${MUN} ${i}-1`,
      "Complemento de Localização": `${i}-1`, "COORDENADA UTM X": "700000", "COORDENADA UTM Y": "7700000",
    })) };
    const t0 = performance.now();
    const r = await post("/os/importar-pendentes/confirmar", "Administrador", lote);
    const ms = Math.round(performance.now() - t0);
    expect(r.statusCode, r.body.slice(0, 200)).toBe(200);
    expect(r.json()).toMatchObject({ recebidas: 200, criadas: 200 });
    console.log(`[medição] lote de 200 OS: ${ms} ms (${(ms / 200).toFixed(1)} ms/OS) → 4.513 OS em 23 lotes ≈ ${Math.round((ms * 4513) / 200 / 1000)} s`);
  }, 120_000);

  it("cidade nova é do Administrador: o Atendente (sem vínculo) não vê a cidade criada pela importação", async () => {
    const cids = (await get("/cidades", "Atendente")).json() as { id: string }[];
    expect(cids.map((c) => c.id)).not.toContain(ordem[0]!.cidade_id);
    const fila = await get(`/os/fila?cidade=${ordem[0]!.cidade_id}`, "Atendente");
    expect(fila.statusCode).toBe(403);
  });
});
