import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { mundo } from "../test/fake-db.js";

vi.mock("../db.js", async () => ({ db: (await import("../test/fake-db.js")).fakeDb }));
const { criarApp } = await import("../app.js");

const PERFIS_REDE = ["Administrador"];
const PERFIS_SUGERIR = ["Administrador"];
const TODOS = ["Administrador", "Supervisor", "Despachante", "Atendente", "Usuário Chave", "Equipe de campo"] as const;
const NEGADOS = TODOS.filter((p) => p !== "Administrador");
const MAPA = { EMERGENCIAL: 0, URGENTE: 1, "<4 HORAS": 1, "<2 DIAS": 1, ALTA: 2, BAIXA: 4, "<90 DIAS": 4 };

const os = (numero: string, circuito: string | null, extra: Record<string, unknown> = {}) => ({
  numero, circuito, circuito_origem: circuito ? "importado" : "nao_identificado", lat: -21.5, lng: -42.6, municipio: "X",
  prioridade_legada: "ALTA", prazo: "2026-02-01T00:00:00Z", clientes: 10, tipo_servico: "t", familia_ativo: "f", origem_geo: "informado", ...extra,
});

let app: FastifyInstance;
const auth = (perfil: string) => ({ authorization: `Bearer tok-${perfil}` });
const chamou = (tabela: string) => mundo.chamadas.filter((c) => c.tabela === tabela);
const dadosConsultados = () => ["os_importadas", "circuitos", "os_importadas_no_raio", "rede_tracado_geojson", "rede_chaves_geojson", "rede_transformadores_json", "sugestoes_rede"]
  .flatMap((t) => chamou(t));

/** OS vizinhas devolvidas pela "busca por raio" simulada: só as que estão a até p_raio_m metros (distância recalculada "no banco"). */
function simularRaio(vizinhas: { numero: string; circuito: string | null; distancia_m: number }[]) {
  mundo.rpcs.os_importadas_no_raio = (a) => ({
    data: vizinhas.filter((v) => v.distancia_m <= (a.p_raio_m as number)).map((v) => ({ ...os(v.numero, v.circuito), distancia_m: v.distancia_m })),
    error: null,
  });
}

beforeEach(() => {
  mundo.reiniciar();
  for (const p of TODOS) {
    mundo.tokens[`tok-${p}`] = `uid-${p}`;
    mundo.tabelas.perfis.push({ user_id: `uid-${p}`, nome: p, perfil: p, todas_cidades: false, equipe_id: null });
  }
  mundo.tabelas.configuracoes = [
    { chave: "rede.perfis_com_acesso", valor: PERFIS_REDE },
    { chave: "rede.perfis_sugerir_carona", valor: PERFIS_SUGERIR },
    { chave: "rede.raio_padrao_m", valor: 1000 },
    { chave: "rede.raio_max_m", valor: 5000 },
    { chave: "rede.mapa_prioridade_legada", valor: MAPA },
  ];
  mundo.tabelas.circuitos = [{ codigo: "LPD-1", clientes: 5 }, { codigo: "CET-LUM 2", clientes: 7 }];
  mundo.tabelas.os_importadas = [os("A", "LPD-1"), os("B", "OUTRO"), os("C", "LPD-1")];
  mundo.rpcs.rede_tracado_geojson = () => ({ data: { type: "FeatureCollection", features: [] }, error: null });
  mundo.rpcs.rede_chaves_geojson = () => ({ data: { type: "FeatureCollection", features: [] }, error: null });
  mundo.rpcs.rede_transformadores_json = () => ({ data: [], error: null });
  simularRaio([]);
});

app = await criarApp({ logger: false });
afterAll(() => app.close());

const get = (url: string, perfil?: string, token?: string) =>
  app.inject({ method: "GET", url, headers: token ? { authorization: `Bearer ${token}` } : perfil ? auth(perfil) : {} });
const post = (url: string, body: unknown, perfil: string) => app.inject({ method: "POST", url, headers: auth(perfil), payload: body as object });

const ROTAS_GET = [
  "/rede/config", "/rede/circuitos/LPD-1", "/rede/circuitos/LPD-1/tracado", "/rede/circuitos/LPD-1/chaves",
  "/rede/circuitos/LPD-1/transformadores", "/rede/os/A/proximas",
];

describe("autenticação", () => {
  it.each(ROTAS_GET)("sem login → 401 e nenhum dado lido: %s", async (url) => {
    const r = await get(url);
    expect(r.statusCode).toBe(401);
    expect(dadosConsultados()).toHaveLength(0);
  });
  it("POST sem login → 401", async () => {
    const r = await app.inject({ method: "POST", url: "/rede/sugestoes", payload: {} });
    expect(r.statusCode).toBe(401);
  });
  it("token inválido → 401", async () => {
    expect((await get("/rede/config", undefined, "lixo")).statusCode).toBe(401);
  });
  it("usuário autenticado sem perfil → 403", async () => {
    mundo.tokens["tok-semperfil"] = "uid-sem";
    const r = await get("/rede/config", undefined, "tok-semperfil");
    expect(r.statusCode).toBe(403);
    expect(dadosConsultados()).toHaveLength(0);
  });
});

describe("Equipe de campo (bloqueada pela regra de perfil dentro da API)", () => {
  it.each(ROTAS_GET)("403 + auditoria e nenhuma leitura de dados: %s", async (url) => {
    const r = await get(url, "Equipe de campo");
    expect(r.statusCode).toBe(403);
    expect(dadosConsultados()).toHaveLength(0);
    const aud = mundo.tabelas.auditoria?.at(-1);
    expect(aud).toMatchObject({ acao: "negado:rede", usuario: "uid-Equipe de campo", resultado: "negado" });
  });
  it("POST /rede/sugestoes → 403 sem tocar nos dados", async () => {
    const r = await post("/rede/sugestoes", { os_origem: "A", os_sugerida: "B", raio_m: 1000 }, "Equipe de campo");
    expect(r.statusCode).toBe(403);
    expect(dadosConsultados()).toHaveLength(0);
  });
});

describe("perfis com acesso vêm da configuração (sem cache, sem valor fixo)", () => {
  it("Administrador → 200", async () => {
    expect((await get("/rede/config", "Administrador")).statusCode).toBe(200);
  });
  it.each(NEGADOS)("%s fica fora da lista → 403, auditado, nenhum dado lido", async (p) => {
    const r = await get("/rede/config", p);
    expect(r.statusCode).toBe(403);
    expect(dadosConsultados()).toHaveLength(0);
    expect(mundo.tabelas.auditoria.at(-1)).toMatchObject({ acao: "negado:rede", resultado: "negado", detalhe: { motivo: "perfil_fora_da_lista" } });
  });
  it.each(NEGADOS)("%s é negado em TODAS as rotas, inclusive as novas", async (p) => {
    for (const url of [...ROTAS_GET, "/rede/circuitos", "/rede/os", "/rede/regionais"]) expect((await get(url, p)).statusCode, url).toBe(403);
    expect((await post("/rede/sugestoes", { os_origem: "A", os_sugerida: "B", raio_m: 1000 }, p)).statusCode).toBe(403);
    expect(dadosConsultados()).toHaveLength(0);
  });
  it("a lista é configuração: incluir o Supervisor libera na hora; retirar o Administrador nega", async () => {
    expect((await get("/rede/config", "Supervisor")).statusCode).toBe(403);
    mundo.tabelas.configuracoes.find((c) => c.chave === "rede.perfis_com_acesso")!.valor = ["Administrador", "Supervisor"];
    expect((await get("/rede/config", "Supervisor")).statusCode).toBe(200);
    mundo.tabelas.configuracoes.find((c) => c.chave === "rede.perfis_com_acesso")!.valor = ["Supervisor"];
    expect((await get("/rede/config", "Administrador")).statusCode).toBe(403);
  });
  it("configuração ausente → nega", async () => {
    mundo.tabelas.configuracoes = mundo.tabelas.configuracoes.filter((c) => c.chave !== "rede.perfis_com_acesso");
    const r = await get("/rede/config", "Administrador");
    expect(r.statusCode).toBe(403);
    expect(mundo.tabelas.auditoria.at(-1)).toMatchObject({ acao: "negado:rede", detalhe: { motivo: "configuracao_indisponivel" } });
  });
  it("falha ao ler a configuração → nega", async () => {
    mundo.falhaTabela.add("configuracoes");
    expect((await get("/rede/config", "Administrador")).statusCode).toBe(403);
  });
  it("configuração fora do formato (não é lista) → nega", async () => {
    mundo.tabelas.configuracoes.find((c) => c.chave === "rede.perfis_com_acesso")!.valor = { Administrador: true };
    expect((await get("/rede/config", "Administrador")).statusCode).toBe(403);
  });
});

describe("GET /rede/config: pode_sugerir calculado no servidor", () => {
  it("Administrador com a lista de sugestão → true, com o raio configurado", async () => {
    expect((await get("/rede/config", "Administrador")).json()).toEqual({ raioPadraoM: 1000, raioMaxM: 5000, pode_sugerir: true });
  });
  it("fora da lista de sugestão → false (mesmo com acesso à rede)", async () => {
    mundo.tabelas.configuracoes.find((c) => c.chave === "rede.perfis_sugerir_carona")!.valor = ["Supervisor"];
    expect((await get("/rede/config", "Administrador")).json().pode_sugerir).toBe(false);
  });
  it("configuração de sugestão ausente → false", async () => {
    mundo.tabelas.configuracoes = mundo.tabelas.configuracoes.filter((c) => c.chave !== "rede.perfis_sugerir_carona");
    expect((await get("/rede/config", "Administrador")).json().pode_sugerir).toBe(false);
  });
});

describe("GET /rede/circuitos (lista)", () => {
  it("campos leves; desconhecido = null (nunca 0); qtd de OS; bbox só se completo", async () => {
    mundo.tabelas.circuitos = [
      { codigo: "A-1", tem_tracado: true, clientes: 10, ligados: 7, desligados: 3, chaves_qtd: 5, bbox_min_lat: -1, bbox_min_lng: -2, bbox_max_lat: 1, bbox_max_lng: 2 },
      { codigo: "SEM", tem_tracado: false, clientes: null, ligados: null, desligados: null, chaves_qtd: null, bbox_min_lat: null, bbox_min_lng: null, bbox_max_lat: null, bbox_max_lng: null },
    ];
    mundo.tabelas.os_importadas = [os("1", "A-1"), os("2", "A-1"), os("3", null)];
    const r = await get("/rede/circuitos", "Administrador");
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.total).toBe(2);
    expect(j.circuitos[0]).toEqual({ codigo: "A-1", tem_tracado: true, chaves_qtd: 5, clientes_total: 10, clientes_ligados: 7, clientes_desligados: 3, qtd_os: 2, bbox: { min_lat: -1, min_lng: -2, max_lat: 1, max_lng: 2 } });
    expect(j.circuitos[1]).toEqual({ codigo: "SEM", tem_tracado: false, chaves_qtd: null, clientes_total: null, clientes_ligados: null, clientes_desligados: null, qtd_os: 0, bbox: null });
  });
  it("falha de leitura → 500, sem lista parcial", async () => {
    mundo.falhaTabela.add("circuitos");
    expect((await get("/rede/circuitos", "Administrador")).statusCode).toBe(500);
  });
});

describe("GET /rede/regionais", () => {
  it("vazia = não configurada", async () => {
    mundo.tabelas.regional = [{ municipio: "A", regional: null }, { municipio: "B", regional: null }];
    expect((await get("/rede/regionais", "Administrador")).json()).toEqual({
      configurada: false, regionais: [], municipios: [{ municipio: "A", regional: null }, { municipio: "B", regional: null }],
    });
  });
  it("com ao menos uma preenchida → configurada, regionais distintas e ordenadas", async () => {
    mundo.tabelas.regional = [{ municipio: "A", regional: "Sul" }, { municipio: "B", regional: "Norte" }, { municipio: "C", regional: "Sul" }, { municipio: "D", regional: null }];
    const j = (await get("/rede/regionais", "Administrador")).json();
    expect(j.configurada).toBe(true);
    expect(j.regionais).toEqual(["Norte", "Sul"]);
  });
});

describe("GET /rede/os (visão geral)", () => {
  beforeEach(() => {
    mundo.tabelas.importacoes = [{ id: 1, importado_em: "2026-10-19T01:00:00Z" }];
    mundo.tabelas.regional = [{ municipio: "X", regional: null }, { municipio: "Y", regional: null }];
  });
  it("campos leves, código mapeado, data da importação, sem dado pessoal", async () => {
    mundo.tabelas.os_importadas = [
      os("U", "LPD-1", { prioridade_legada: "URGENTE", municipio: "X", endereco: "RUA SECRETA", cliente: "FULANO" }),
      os("S", null, { prioridade_legada: "NOVA-FAIXA" }),
    ];
    const r = await get("/rede/os", "Administrador");
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.importado_em).toBe("2026-10-19T01:00:00Z");
    expect(j.total).toBe(2);
    expect(j.os[0]).toEqual({
      numero: "U", circuito: "LPD-1", circuito_origem: "importado", lat: -21.5, lng: -42.6, municipio: "X",
      prioridade_legada: "URGENTE", prioridade_codigo: 1, prazo: "2026-02-01T00:00:00Z", tipo_servico: "t",
    });
    expect(j.os[1].prioridade_codigo).toBeNull(); // sem mapa ≠ 0
    expect(JSON.stringify(j)).not.toMatch(/SECRETA|FULANO|endereco/);
  });
  it("devolve TODAS as OS mesmo acima do limite de 1000 por resposta do PostgREST", async () => {
    mundo.tabelas.os_importadas = Array.from({ length: 2500 }, (_, i) => os(`N${String(i).padStart(4, "0")}`, "LPD-1"));
    const j = (await get("/rede/os", "Administrador")).json();
    expect(j.total).toBe(2500);
    expect(new Set(j.os.map((o: { numero: string }) => o.numero)).size).toBe(2500);
  });
  it("?circuito= filtra no banco com valor vinculado (inclusive com espaço)", async () => {
    mundo.tabelas.os_importadas = [os("A", "CET-LUM 2"), os("B", "LPD-1")];
    const j = (await get("/rede/os?circuito=CET-LUM%202", "Administrador")).json();
    expect(j.os.map((o: { numero: string }) => o.numero)).toEqual(["A"]);
    expect(chamou("os_importadas")[0]!.filtros).toEqual([["circuito", "CET-LUM 2"]]);
  });
  it("regional NÃO configurada: ?regional= é ignorado, nada é escondido e a resposta avisa", async () => {
    mundo.tabelas.os_importadas = [os("A", "LPD-1", { municipio: "X" }), os("B", "LPD-1", { municipio: "Y" })];
    const j = (await get("/rede/os?regional=Sul", "Administrador")).json();
    expect(j.total).toBe(2);
    expect(j.filtro_regional).toEqual({ configurada: false, aplicado: false });
  });
  it("regional configurada: filtra pelos municípios dela; regional inexistente → 400", async () => {
    mundo.tabelas.regional = [{ municipio: "X", regional: "Sul" }, { municipio: "Y", regional: "Norte" }];
    mundo.tabelas.os_importadas = [os("A", "LPD-1", { municipio: "X" }), os("B", "LPD-1", { municipio: "Y" }), os("C", "LPD-1", { municipio: null })];
    const j = (await get("/rede/os?regional=Sul", "Administrador")).json();
    expect(j.os.map((o: { numero: string }) => o.numero)).toEqual(["A"]);
    expect(j.filtro_regional).toEqual({ configurada: true, aplicado: true });
    expect((await get("/rede/os?regional=Leste", "Administrador")).statusCode).toBe(400);
    expect((await get("/rede/os", "Administrador")).json().total).toBe(3); // sem parâmetro, nada some
  });
  it("circuito com mais de 64 caracteres → 400; falha de leitura → 500", async () => {
    expect((await get(`/rede/os?circuito=${"A".repeat(65)}`, "Administrador")).statusCode).toBe(400);
    mundo.falhaTabela.add("os_importadas");
    expect((await get("/rede/os", "Administrador")).statusCode).toBe(500);
  });
});

describe("GET /rede/circuitos/:codigo", () => {
  it("OS ordenadas por prioridade mapeada, prazo e número; sem mapa por último; marcada como informativa", async () => {
    mundo.tabelas.os_importadas = [
      os("Z9", "LPD-1", { prioridade_legada: "BAIXA" }),
      os("S1", "LPD-1", { prioridade_legada: "DESCONHECIDA" }),
      os("B2", "LPD-1", { prioridade_legada: "URGENTE", prazo: "2026-03-01T00:00:00Z" }),
      os("B1", "LPD-1", { prioridade_legada: "<4 HORAS", prazo: "2026-03-01T00:00:00Z" }),
      os("B0", "LPD-1", { prioridade_legada: "URGENTE", prazo: "2026-02-01T00:00:00Z" }),
      os("E0", "LPD-1", { prioridade_legada: "EMERGENCIAL" }),
      os("OUTRO", "XX-1"),
    ];
    const r = await get("/rede/circuitos/LPD-1", "Administrador");
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.ordem_informativa).toBe(true);
    expect(j.aviso_ordem).toMatch(/NÃO é a fila/);
    expect(j.os.map((o: { numero: string }) => o.numero)).toEqual(["E0", "B0", "B1", "B2", "Z9", "S1"]);
    expect(j.os.find((o: { numero: string }) => o.numero === "S1").prioridade_codigo).toBeNull(); // sem mapa ≠ 0
    expect(j.os.find((o: { numero: string }) => o.numero === "E0").prioridade_codigo).toBe(0);
  });
  it("circuito inexistente → 404", async () => {
    expect((await get("/rede/circuitos/NAO-EXISTE", "Administrador")).statusCode).toBe(404);
  });
  it.each(["/rede/circuitos/NAO-EXISTE/tracado", "/rede/circuitos/NAO-EXISTE/chaves", "/rede/circuitos/NAO-EXISTE/transformadores"])("404 e sem RPC: %s", async (url) => {
    expect((await get(url, "Administrador")).statusCode).toBe(404);
    expect(chamou("rede_tracado_geojson") .concat(chamou("rede_chaves_geojson"), chamou("rede_transformadores_json"))).toHaveLength(0);
  });
  it("traçado: bt só com ?bt=1", async () => {
    await get("/rede/circuitos/LPD-1/tracado", "Administrador");
    await get("/rede/circuitos/LPD-1/tracado?bt=1", "Administrador");
    expect(chamou("rede_tracado_geojson").map((c) => Object.fromEntries(c.filtros).p_incluir_bt)).toEqual([false, true]);
  });
});

describe('código de circuito com espaço ("CET-LUM 2") e entrada hostil: sempre parâmetro vinculado', () => {
  it("GET /rede/circuitos/CET-LUM%202", async () => {
    const r = await get("/rede/circuitos/CET-LUM%202", "Administrador");
    expect(r.statusCode).toBe(200);
    expect(r.json().circuito.codigo).toBe("CET-LUM 2");
    expect(chamou("circuitos")[0]!.filtros).toEqual([["codigo", "CET-LUM 2"]]);
    expect(chamou("os_importadas")[0]!.filtros).toEqual([["circuito", "CET-LUM 2"]]);
  });
  it.each(["tracado", "chaves", "transformadores"])("RPC de %s recebe o código exato", async (s) => {
    const r = await get(`/rede/circuitos/CET-LUM%202/${s}`, "Administrador");
    expect(r.statusCode).toBe(200);
    const nome = s === "tracado" ? "rede_tracado_geojson" : s === "chaves" ? "rede_chaves_geojson" : "rede_transformadores_json";
    expect(Object.fromEntries(chamou(nome)[0]!.filtros).p_circuito).toBe("CET-LUM 2");
  });
  it("texto com aspas/ponto e vírgula chega intacto como valor e não encontra nada", async () => {
    const hostil = "X'); drop table circuitos;--";
    const r = await get(`/rede/circuitos/${encodeURIComponent(hostil)}`, "Administrador");
    expect(r.statusCode).toBe(404);
    expect(chamou("circuitos")[0]!.filtros).toEqual([["codigo", hostil]]);
    expect(mundo.tabelas.circuitos).toHaveLength(2);
  });
  it("código com mais de 64 caracteres → 400", async () => {
    expect((await get(`/rede/circuitos/${"A".repeat(65)}`, "Administrador")).statusCode).toBe(400);
  });
});

describe("GET /rede/os/:numero/proximas", () => {
  beforeEach(() => {
    mundo.tabelas.os_importadas = [os("A", "LPD-1"), os("B", "OUTRO"), os("SEM", "LPD-1", { lat: null, lng: null })];
    simularRaio([{ numero: "A", circuito: "LPD-1", distancia_m: 0 }, { numero: "B", circuito: "OUTRO", distancia_m: 300 }]);
  });
  it("sem raio usa o padrão configurado, remove a própria OS e marca ordem informativa", async () => {
    const r = await get("/rede/os/A/proximas", "Administrador");
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j.raio_m).toBe(1000);
    expect(j.ordem_informativa).toBe(true);
    expect(j.os.map((o: { numero: string }) => o.numero)).toEqual(["B"]);
    expect(Object.fromEntries(chamou("os_importadas_no_raio")[0]!.filtros)).toMatchObject({ p_raio_m: 1000, p_excluir_circuito: "LPD-1" });
  });
  it.each(["0", "-5", "abc", "5001", "1e9"])("raio inválido (%s) → 400 sem chamar a busca", async (v) => {
    const r = await get(`/rede/os/A/proximas?raio_m=${v}`, "Administrador");
    expect(r.statusCode).toBe(400);
    expect(chamou("os_importadas_no_raio")).toHaveLength(0);
  });
  it("raio no máximo (5000) é aceito", async () => {
    expect((await get("/rede/os/A/proximas?raio_m=5000", "Administrador")).statusCode).toBe(200);
  });
  it("OS inexistente → 404; OS sem coordenada → 422 (desconhecido não vira 'sem vizinhas')", async () => {
    expect((await get("/rede/os/NAO/proximas", "Administrador")).statusCode).toBe(404);
    expect((await get("/rede/os/SEM/proximas", "Administrador")).statusCode).toBe(422);
  });
  it("ordena por distância", async () => {
    simularRaio([{ numero: "B", circuito: "OUTRO", distancia_m: 800 }, { numero: "C", circuito: "OUTRO", distancia_m: 100 }]);
    mundo.tabelas.os_importadas.push(os("C", "OUTRO"));
    const j = (await get("/rede/os/A/proximas", "Administrador")).json();
    expect(j.os.map((o: { numero: string }) => o.numero)).toEqual(["C", "B"]);
  });
});

describe("POST /rede/sugestoes", () => {
  beforeEach(() => {
    mundo.tabelas.os_importadas = [os("A", "LPD-1"), os("B", "OUTRO"), os("MESMO", "LPD-1"), os("SEM", "XX-9", { lat: null, lng: null })];
    simularRaio([{ numero: "B", circuito: "OUTRO", distancia_m: 800 }, { numero: "MESMO", circuito: "LPD-1", distancia_m: 50 }]);
  });
  const corpo = (o: Record<string, unknown> = {}) => ({ os_origem: "A", os_sugerida: "B", raio_m: 1000, ...o });

  it.each(PERFIS_SUGERIR)("%s → 201, usuário vem do token, auditado", async (p) => {
    const r = await post("/rede/sugestoes", corpo(), p);
    expect(r.statusCode).toBe(201);
    expect(mundo.tabelas.sugestoes_rede).toEqual([expect.objectContaining({ os_origem: "A", os_sugerida: "B", raio_m: 1000, usuario: `uid-${p}` })]);
    expect(mundo.tabelas.auditoria?.at(-1)).toMatchObject({ acao: "rede:sugerir", usuario: `uid-${p}`, resultado: "ok" });
  });
  it("Administrador pode sugerir (caso explícito)", async () => {
    expect((await post("/rede/sugestoes", corpo(), "Administrador")).statusCode).toBe(201);
  });
  it.each(["Supervisor", "Despachante"])("%s é negado: fora de acesso e de sugestão → 403, nada gravado", async (p) => {
    const r = await post("/rede/sugestoes", corpo(), p);
    expect(r.statusCode).toBe(403);
    expect(mundo.tabelas.sugestoes_rede).toHaveLength(0);
    expect(mundo.tabelas.auditoria.at(-1)).toMatchObject({ acao: "negado:rede" });
  });
  it("com acesso à rede mas fora da lista de sugestão → 403 `negado:rede_sugestao`", async () => {
    mundo.tabelas.configuracoes.find((c) => c.chave === "rede.perfis_com_acesso")!.valor = ["Administrador", "Supervisor"];
    expect((await get("/rede/config", "Supervisor")).statusCode).toBe(200);
    const r = await post("/rede/sugestoes", corpo(), "Supervisor");
    expect(r.statusCode).toBe(403);
    expect(mundo.tabelas.sugestoes_rede).toHaveLength(0);
    expect(mundo.tabelas.auditoria.at(-1)).toMatchObject({ acao: "negado:rede_sugestao" });
  });
  it("perfil de quem sugere é configuração: retirar o Administrador da lista nega", async () => {
    mundo.tabelas.configuracoes.find((c) => c.chave === "rede.perfis_sugerir_carona")!.valor = ["Supervisor"];
    expect((await post("/rede/sugestoes", corpo(), "Administrador")).statusCode).toBe(403);
  });
  it("configuração de quem sugere ausente → nega", async () => {
    mundo.tabelas.configuracoes = mundo.tabelas.configuracoes.filter((c) => c.chave !== "rede.perfis_sugerir_carona");
    expect((await post("/rede/sugestoes", corpo(), "Administrador")).statusCode).toBe(403);
  });
  it("usuário enviado no corpo é recusado (strict); o do token é o que vale", async () => {
    const r = await post("/rede/sugestoes", corpo({ usuario: "uid-outro" }), "Administrador");
    expect(r.statusCode).toBe(400);
    expect(mundo.tabelas.sugestoes_rede ?? []).toHaveLength(0);
  });
  it("OS sugerindo a si mesma → 400", async () => {
    expect((await post("/rede/sugestoes", corpo({ os_sugerida: "A" }), "Administrador")).statusCode).toBe(400);
  });
  it("mesmo circuito → 422", async () => {
    expect((await post("/rede/sugestoes", corpo({ os_sugerida: "MESMO" }), "Administrador")).statusCode).toBe(422);
  });
  it("fora do raio informado é recalculado no servidor → 422; ampliando o raio, 201", async () => {
    expect((await post("/rede/sugestoes", corpo({ raio_m: 500 }), "Administrador")).statusCode).toBe(422);
    expect(mundo.tabelas.sugestoes_rede ?? []).toHaveLength(0);
    expect((await post("/rede/sugestoes", corpo({ raio_m: 900 }), "Administrador")).statusCode).toBe(201);
  });
  it("duplicada → 409", async () => {
    expect((await post("/rede/sugestoes", corpo(), "Administrador")).statusCode).toBe(201);
    expect((await post("/rede/sugestoes", corpo(), "Administrador")).statusCode).toBe(409);
    expect(mundo.tabelas.sugestoes_rede).toHaveLength(1);
  });
  it("simétrica: A→B e B→A são a mesma sugestão → o inverso dá 409", async () => {
    simularRaio([{ numero: "A", circuito: "LPD-1", distancia_m: 800 }, { numero: "B", circuito: "OUTRO", distancia_m: 800 }]);
    expect((await post("/rede/sugestoes", corpo(), "Administrador")).statusCode).toBe(201);
    expect((await post("/rede/sugestoes", corpo({ os_origem: "B", os_sugerida: "A" }), "Administrador")).statusCode).toBe(409);
    expect(mundo.tabelas.sugestoes_rede).toHaveLength(1);
  });
  it.each([0, -1, 5001])("raio %s → 400", async (raio_m) => {
    expect((await post("/rede/sugestoes", corpo({ raio_m }), "Administrador")).statusCode).toBe(400);
  });
  it("corpo incompleto ou com tipos errados → 400", async () => {
    expect((await post("/rede/sugestoes", { os_origem: "A" }, "Administrador")).statusCode).toBe(400);
    expect((await post("/rede/sugestoes", corpo({ raio_m: "1000" }), "Administrador")).statusCode).toBe(400);
  });
  it("OS inexistente → 404; OS sem coordenada → 422", async () => {
    expect((await post("/rede/sugestoes", corpo({ os_sugerida: "NAO" }), "Administrador")).statusCode).toBe(404);
    expect((await post("/rede/sugestoes", corpo({ os_sugerida: "SEM" }), "Administrador")).statusCode).toBe(422);
  });
});
