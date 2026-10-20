// Teste com LOGIN REAL no Supabase LOCAL (auth + PostgREST + banco com a carga da importação).
// Rode: npm run test:integracao   (carrega .env.docker). Recusa qualquer destino que não seja 127.0.0.1/localhost:54322.
// Cria usuários descartáveis (e-mail @farol-teste.local) e os remove ao final; as linhas de `auditoria` (imutável) permanecem.
// Regra do módulo da rede: SOMENTE o Administrador acessa e sugere. Os demais perfis (e a Equipe de campo) recebem 403.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { FastifyInstance } from "fastify";

const dbUrl = process.env.DATABASE_URL ?? "";
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const ANON = process.env.SUPABASE_ANON_KEY ?? "";
const configurado = !!(dbUrl && SERVICE && ANON);

const sufixo = Date.now().toString(36);
const SENHA = `Senha-${sufixo}-Teste!`;
const email = (n: string) => `${n}.${sufixo}@farol-teste.local`;

let app: FastifyInstance;
let admin: SupabaseClient;
let BASE = "";
const ids: Record<string, string> = {};
const tokens: Record<string, string> = {};
let osOrigem = "", osVizinha = "", latOrigem = 0, lngOrigem = 0;

const NEGADOS = ["Equipe de campo", "Supervisor", "Despachante", "Atendente", "Usuário Chave"] as const;
const ROTAS_LEITURA = [
  "/rede/config", "/rede/circuitos", "/rede/regionais", "/rede/os", "/rede/circuitos/LPD-1", "/rede/circuitos/LPD-1/tracado",
  "/rede/circuitos/LPD-1/chaves", "/rede/circuitos/LPD-1/transformadores",
];

const rest = async (token: string | null, path: string, init: { method?: string; body?: unknown } = {}) => {
  const r = await fetch(`${BASE}/rest/v1/${path}`, {
    method: init.method ?? "GET",
    headers: { apikey: ANON, ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  const txt = await r.text();
  let corpo: unknown = txt;
  try { corpo = JSON.parse(txt); } catch { /* texto puro */ }
  return { status: r.status, corpo };
};
/** "Sem dados": lista vazia (RLS) OU recusa explícita (4xx). Nunca linhas. */
const semDados = (r: { status: number; corpo: unknown }) => r.status >= 400 || (Array.isArray(r.corpo) && r.corpo.length === 0);
const api = (url: string, perfil: string, init: { method?: "GET" | "POST"; payload?: object } = {}) =>
  app.inject({ method: init.method ?? "GET", url, headers: { authorization: `Bearer ${tokens[perfil]!}` }, payload: init.payload });
const contar = async (tabela: string) => (await admin.from(tabela).select("*", { count: "exact", head: true })).count ?? 0;

describe.skipIf(!configurado)("rede: login real, API e PostgREST direto", () => {
  beforeAll(async () => {
    const u = new URL(dbUrl);
    if (!["127.0.0.1", "localhost"].includes(u.hostname) || u.port !== "54322") throw new Error(`Integração recusada: destino não é o banco local (${u.hostname}:${u.port}).`);
    BASE = `http://${u.hostname}:54321`;
    process.env.SUPABASE_URL = BASE;
    admin = createClient(BASE, SERVICE, { auth: { persistSession: false } });

    const novos: [string, string | null][] = [
      ["campo", "Equipe de campo"], ["administrador", "Administrador"], ["semperfil", null], ["supervisor", "Supervisor"],
      ["despachante", "Despachante"], ["atendente", "Atendente"], ["usuariochave", "Usuário Chave"],
    ];
    for (const [nome, perfil] of novos) {
      const { data, error } = await admin.auth.admin.createUser({ email: email(nome), password: SENHA, email_confirm: true });
      if (error) throw new Error(`createUser ${nome}: ${error.message}`);
      ids[nome] = data.user.id;
      if (perfil) {
        const { error: e2 } = await admin.from("perfis").insert({ user_id: data.user.id, nome: `teste ${nome}`, perfil, todas_cidades: false });
        if (e2) throw new Error(`perfis ${nome}: ${e2.message}`);
      }
      const cli = createClient(BASE, ANON, { auth: { persistSession: false } });
      const { data: s, error: e3 } = await cli.auth.signInWithPassword({ email: email(nome), password: SENHA });
      if (e3 || !s.session) throw new Error(`login ${nome}: ${e3?.message}`);
      tokens[perfil ?? nome] = s.session.access_token;
    }

    // Par de OS reais de circuitos diferentes a menos de 1 km (para as sugestões).
    const { data: o } = await admin.from("os_importadas").select("numero, lat, lng").eq("circuito", "LPD-1").not("geom", "is", null).order("numero").limit(1).single();
    osOrigem = o!.numero; latOrigem = o!.lat; lngOrigem = o!.lng;
    const { data: viz } = await admin.rpc("os_importadas_no_raio", { p_lat: latOrigem, p_lng: lngOrigem, p_raio_m: 1000, p_excluir_circuito: "LPD-1", p_regional: null });
    osVizinha = (viz as { numero: string }[])[0]!.numero;

    const { criarApp } = await import("../app.js");
    app = await criarApp({ logger: false });
  });

  afterAll(async () => {
    await app?.close();
    for (const id of Object.values(ids)) {
      await admin.from("sugestoes_rede").delete().eq("usuario", id);
      await admin.from("perfis").delete().eq("user_id", id);
      await admin.auth.admin.deleteUser(id);
    }
  });

  it("configuração do banco: acesso e sugestão são só do Administrador", async () => {
    const { data } = await admin.from("configuracoes").select("chave, valor").in("chave", ["rede.perfis_com_acesso", "rede.perfis_sugerir_carona"]).order("chave");
    expect(data).toEqual([
      { chave: "rede.perfis_com_acesso", valor: ["Administrador"] },
      { chave: "rede.perfis_sugerir_carona", valor: ["Administrador"] },
    ]);
  });

  it("sem login e com token inválido a API devolve 401", async () => {
    expect((await app.inject({ method: "GET", url: "/rede/config" })).statusCode).toBe(401);
    expect((await app.inject({ method: "GET", url: "/rede/os", headers: { authorization: "Bearer lixo" } })).statusCode).toBe(401);
  });

  describe("perfis negados (Equipe de campo, Supervisor, Despachante, Atendente, Usuário Chave)", () => {
    it.each(NEGADOS)("%s: API → 403 em todas as rotas e na sugestão", async (perfil) => {
      for (const url of [...ROTAS_LEITURA, `/rede/os/${encodeURIComponent(osOrigem)}/proximas`]) {
        expect((await api(url, perfil)).statusCode, `${perfil} ${url}`).toBe(403);
      }
      const r = await api("/rede/sugestoes", perfil, { method: "POST", payload: { os_origem: osOrigem, os_sugerida: osVizinha, raio_m: 1000 } });
      expect(r.statusCode).toBe(403);
    });
    it.each(NEGADOS)("%s: PostgREST direto (JWT dele) → zero linhas", async (perfil) => {
      for (const tabela of ["circuitos", "os_importadas", "regional"]) {
        expect(semDados(await rest(tokens[perfil]!, `${tabela}?select=*&limit=5`)), `${perfil} ${tabela}`).toBe(true);
      }
    });
    it("Equipe de campo: também zero linhas nas tabelas grandes e nas funções de rede", async () => {
      const t = tokens["Equipe de campo"]!;
      for (const tabela of ["rede_chaves", "rede_transformadores", "rede_tracado"]) {
        expect(semDados(await rest(t, `${tabela}?select=*&limit=5`)), tabela).toBe(true);
      }
      const raio = await rest(t, "rpc/os_importadas_no_raio", { method: "POST", body: { p_lat: latOrigem, p_lng: lngOrigem, p_raio_m: 1000 } });
      expect(semDados(raio)).toBe(true);
      const geo = await rest(t, "rpc/rede_chaves_geojson", { method: "POST", body: { p_circuito: "LPD-1" } });
      expect(geo.status >= 400 || (geo.corpo as { features?: unknown[] }).features?.length === 0).toBe(true);
    });
  });

  describe("Administrador (único perfil permitido)", () => {
    it("config: raio e pode_sugerir calculado no servidor", async () => {
      const cfg = await api("/rede/config", "Administrador");
      expect(cfg.statusCode).toBe(200);
      expect(cfg.json()).toEqual({ raioPadraoM: 1000, raioMaxM: 5000, pode_sugerir: true });
    });

    it("circuito, traçado, chaves, transformadores e código com espaço", async () => {
      const c = await api("/rede/circuitos/LPD-1", "Administrador");
      expect(c.statusCode).toBe(200);
      expect(c.json().ordem_informativa).toBe(true);
      expect(c.json().os.length).toBeGreaterThan(0);
      expect(c.json().circuito.clientes).toBeGreaterThan(0);

      const sp = await api("/rede/circuitos/CET-LUM%202", "Administrador");
      expect(sp.statusCode).toBe(200);
      expect(sp.json().circuito.codigo).toBe("CET-LUM 2");
      // "CET-LUM 2" é grafia sem correspondência na base de chaves (a base usa "CET-LUM2"): NÃO é corrigida; chaves vêm vazias.
      const ch = await api("/rede/circuitos/CET-LUM%202/chaves", "Administrador");
      expect(ch.statusCode).toBe(200);
      expect(ch.json().features).toEqual([]);
      expect((await api("/rede/circuitos/LPD-1/chaves", "Administrador")).json().features.length).toBeGreaterThan(0);

      const tr = await api("/rede/circuitos/LPD-5/tracado", "Administrador");
      expect(tr.statusCode).toBe(200);
      expect(tr.json().features.length).toBeGreaterThan(0);
      expect((await api("/rede/circuitos/LPD-1/transformadores", "Administrador")).json().length).toBeGreaterThan(0);
      expect((await api("/rede/circuitos/NAO-EXISTE", "Administrador")).statusCode).toBe(404);
    });

    it("GET /rede/circuitos: todos os circuitos, nulos preservados, OS por circuito conferidas com o banco", async () => {
      const r = await api("/rede/circuitos", "Administrador");
      expect(r.statusCode).toBe(200);
      const j = r.json() as { total: number; circuitos: { codigo: string; tem_tracado: boolean; clientes_total: number | null; qtd_os: number; bbox: unknown }[] };
      expect(j.total).toBe(await contar("circuitos"));
      expect(j.circuitos.filter((c) => c.tem_tracado)).toHaveLength(9);
      expect(j.circuitos.some((c) => c.clientes_total === null)).toBe(true); // desconhecido ≠ 0
      expect(j.circuitos.some((c) => c.bbox === null)).toBe(true);
      const lpd1 = j.circuitos.find((c) => c.codigo === "LPD-1")!;
      const { count } = await admin.from("os_importadas").select("*", { count: "exact", head: true }).eq("circuito", "LPD-1");
      expect(lpd1.qtd_os).toBe(count);
      // OS cujo código de circuito não existe na tabela circuitos (ex.: CQT1-CQT, grafia sem correspondência) não entram na lista; seguem em /rede/os.
      const codigos = new Set(j.circuitos.map((c) => c.codigo));
      const todas: { circuito: string | null }[] = [];
      for (let de = 0; ; de += 1000) {
        const { data } = await admin.from("os_importadas").select("circuito").order("numero").range(de, de + 999);
        todas.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      expect(todas).toHaveLength(await contar("os_importadas"));
      expect(j.circuitos.reduce((s, c) => s + c.qtd_os, 0)).toBe(todas.filter((o) => o.circuito !== null && codigos.has(o.circuito)).length);
    });

    it("GET /rede/os: todas as OS (acima de 1000), sem dado pessoal, com data da importação; mede tempo e tamanho", async () => {
      const total = await contar("os_importadas");
      expect(total).toBeGreaterThan(1000);
      const medidas: { ms: number; bytes: number }[] = [];
      let corpo: { total: number; importado_em: string | null; filtro_regional: unknown; os: Record<string, unknown>[] } | null = null;
      for (let i = 0; i < 3; i++) {
        const t0 = performance.now();
        const r = await api("/rede/os", "Administrador");
        medidas.push({ ms: Math.round(performance.now() - t0), bytes: r.rawPayload.length });
        expect(r.statusCode).toBe(200);
        corpo = r.json();
      }
      console.log(`[medição] GET /rede/os (${total} OS) → ${medidas.map((m, i) => `#${i + 1}: ${m.ms} ms`).join(" | ")} | tamanho: ${medidas[0]!.bytes} bytes (${(medidas[0]!.bytes / 1024).toFixed(0)} kB, sem compressão)`);
      expect(corpo!.total).toBe(total);
      expect(new Set(corpo!.os.map((o) => o.numero)).size).toBe(total);
      expect(corpo!.importado_em).not.toBeNull();
      expect(corpo!.filtro_regional).toEqual({ configurada: false, aplicado: false }); // 92 municípios, todos sem regional
      expect(Object.keys(corpo!.os[0]!).sort()).toEqual(["circuito", "circuito_origem", "lat", "lng", "municipio", "numero", "prazo", "prioridade_codigo", "prioridade_legada", "tipo_servico"]);
      expect(corpo!.os.filter((o) => o.prioridade_codigo === null)).toHaveLength(0); // nenhuma OS sem mapa na carga atual
      const semCircuito = corpo!.os.filter((o) => o.circuito_origem === "nao_identificado").length;
      const { count } = await admin.from("os_importadas").select("*", { count: "exact", head: true }).eq("circuito_origem", "nao_identificado");
      expect(semCircuito).toBe(count);
    });

    it("GET /rede/os com filtros: ?circuito= (inclusive com espaço) e ?regional= ignorado quando não configurada", async () => {
      const a = (await api("/rede/os?circuito=LPD-1", "Administrador")).json();
      const { count } = await admin.from("os_importadas").select("*", { count: "exact", head: true }).eq("circuito", "LPD-1");
      expect(a.total).toBe(count);
      expect(a.os.every((o: { circuito: string }) => o.circuito === "LPD-1")).toBe(true);
      const b = (await api("/rede/os?circuito=CET-LUM%202", "Administrador")).json();
      expect(b.os.every((o: { circuito: string }) => o.circuito === "CET-LUM 2")).toBe(true);
      const c = (await api("/rede/os?regional=Qualquer", "Administrador")).json();
      expect(c.total).toBe(await contar("os_importadas"));
      expect(c.filtro_regional).toEqual({ configurada: false, aplicado: false });
    });

    it("GET /rede/regionais: município → regional, todas vazias = não configurada", async () => {
      const r = await api("/rede/regionais", "Administrador");
      expect(r.statusCode).toBe(200);
      const j = r.json();
      expect(j.configurada).toBe(false);
      expect(j.regionais).toEqual([]);
      expect(j.municipios).toHaveLength(await contar("regional"));
    });

    it("OS próximas em outros circuitos; raio acima do máximo → 400", async () => {
      const r = await api(`/rede/os/${encodeURIComponent(osOrigem)}/proximas?raio_m=1000`, "Administrador");
      expect(r.statusCode).toBe(200);
      const lista = r.json().os as { numero: string; circuito: string | null; distancia_m: number }[];
      expect(lista.length).toBeGreaterThan(0);
      expect(lista.every((o) => o.circuito !== "LPD-1" && o.numero !== osOrigem && o.distancia_m <= 1000)).toBe(true);
      expect(lista.map((o) => o.distancia_m)).toEqual([...lista.map((o) => o.distancia_m)].sort((a, b) => a - b));
      expect((await api(`/rede/os/${encodeURIComponent(osOrigem)}/proximas?raio_m=5001`, "Administrador")).statusCode).toBe(400);
    });

    it("sugerir junto: 201 (usuário do token); repetir → 409; INVERSO → 409 (par não ordenado); fora do raio → 422", async () => {
      const corpo = { os_origem: osOrigem, os_sugerida: osVizinha, raio_m: 1000 };
      const r = await api("/rede/sugestoes", "Administrador", { method: "POST", payload: corpo });
      expect(r.statusCode).toBe(201);
      const { data } = await admin.from("sugestoes_rede").select("usuario, os_origem, os_sugerida").eq("id", r.json().id).single();
      expect(data).toEqual({ usuario: ids.administrador, os_origem: osOrigem, os_sugerida: osVizinha });
      expect((await api("/rede/sugestoes", "Administrador", { method: "POST", payload: corpo })).statusCode).toBe(409);
      const inverso = await api("/rede/sugestoes", "Administrador", { method: "POST", payload: { os_origem: osVizinha, os_sugerida: osOrigem, raio_m: 1000 } });
      expect(inverso.statusCode).toBe(409);
      const { count } = await admin.from("sugestoes_rede").select("*", { count: "exact", head: true }).eq("usuario", ids.administrador!);
      expect(count).toBe(1);
      expect((await api("/rede/sugestoes", "Administrador", { method: "POST", payload: { ...corpo, raio_m: 1 } })).statusCode).toBe(422);
    });

    it("controle: no PostgREST o Administrador enxerga dados (logo o zero dos demais vem da regra de perfil)", async () => {
      const r = await rest(tokens.Administrador!, "circuitos?select=codigo&limit=3");
      expect(r.status).toBe(200);
      expect((r.corpo as unknown[]).length).toBeGreaterThan(0);
    });
  });

  describe("usuário autenticado comum, fora da regra de perfil, direto no PostgREST", () => {
    it("sem perfil: API 403 e zero linhas em toda a rede", async () => {
      const r = await app.inject({ method: "GET", url: "/rede/config", headers: { authorization: `Bearer ${tokens.semperfil!}` } });
      expect(r.statusCode).toBe(403);
      for (const tabela of ["os_importadas", "circuitos", "rede_chaves", "rede_transformadores", "rede_tracado"]) {
        expect(semDados(await rest(tokens.semperfil!, `${tabela}?select=*&limit=5`)), tabela).toBe(true);
      }
      const raio = await rest(tokens.semperfil!, "rpc/os_importadas_no_raio", { method: "POST", body: { p_lat: latOrigem, p_lng: lngOrigem, p_raio_m: 1000 } });
      expect(semDados(raio)).toBe(true);
    });
    it("chave anônima sem login: sem dados", async () => {
      for (const tabela of ["os_importadas", "circuitos", "rede_chaves", "rede_transformadores", "rede_tracado"]) {
        expect(semDados(await rest(null, `${tabela}?select=*&limit=5`)), tabela).toBe(true);
      }
    });
    it("mesmo o Administrador não escreve direto: sugestões e tabelas de rede ficam só com a API", async () => {
      const ins = await rest(tokens.Administrador!, "sugestoes_rede", { method: "POST", body: { os_origem: "X", os_sugerida: "Y", raio_m: 10, usuario: ids.administrador } });
      expect(ins.status).toBeGreaterThanOrEqual(400);
      expect(semDados(await rest(tokens.Administrador!, "sugestoes_rede?select=*&limit=5"))).toBe(true);
      const upd = await rest(tokens.Administrador!, `circuitos?codigo=eq.LPD-1`, { method: "PATCH", body: { clientes: 0 } });
      expect(upd.status >= 400 || upd.corpo === "" || (Array.isArray(upd.corpo) && upd.corpo.length === 0)).toBe(true);
      const { data } = await admin.from("circuitos").select("clientes").eq("codigo", "LPD-1").single();
      expect(data!.clientes).toBeGreaterThan(0);
    });
  });
});
