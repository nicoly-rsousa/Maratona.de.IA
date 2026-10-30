import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { REGRAS_DEMO, VERSAO_DEMO } from "@farol/shared";
import { mundo } from "../test/fake-db.js";

vi.mock("../db.js", async () => ({ db: (await import("../test/fake-db.js")).fakeDb }));
// motor: a versão e as regras DEMONSTRATIVAS (mesmos valores do seed); o resto do fluxo é o código real
const versaoVigente = vi.fn(async (_cidade: string) => ({ id: "11111111-1111-1111-1111-111111111111", versao: VERSAO_DEMO }));
vi.mock("../config.js", () => ({
  versaoVigente: (c: string) => versaoVigente(c),
  regrasEmVigor: async () => ({ numero: 7, justificativa: "teste", regras: REGRAS_DEMO }),
  carregarPublicadas: async () => [], regrasAtivas: async () => REGRAS_DEMO,
}));
const { criarApp } = await import("../app.js");

const CAB = ["OSNumero", "CodSetor", "CodPrioridade", "DataDeadline", "Quantidade clientes", "Localidade", "Logradouro", "Bairro", "Complemento de Localização",
  "COORDENADA UTM X", "COORDENADA UTM Y", "DescEsquema", "Familias"];
type L = Partial<Record<string, string>>;
const lin = (n: number, o: L) => ({ linha: n, valores: CAB.map((c) => o[c] ?? "") });
const tabela = (...ls: L[]) => ({ cabecalho: CAB, linhas: ls.map((o, i) => lin(i + 2, o)) });
const UTM = { "COORDENADA UTM X": "700000", "COORDENADA UTM Y": "7700000" };
const OS_A: L = { OSNumero: "EMG-A  001/2026", CodSetor: "LPD-1", CodPrioridade: "ALTA", DataDeadline: "04/01/2026", "Quantidade clientes": "12", Localidade: "MURIAE 48-160", "Complemento de Localização": "48-160", ...UTM, DescEsquema: "Poda", Familias: "REDE" };
const OS_B: L = { OSNumero: "EMG-B", Localidade: "MURIAE 1-1" };                                    // só o mínimo, sem coordenada
const OS_C: L = { OSNumero: "EMG-C", Localidade: "MURY / NOVA FRIBURGO 257-1", ...UTM };

let app: FastifyInstance;
const tab = (n: string) => (mundo.tabelas[n] ??= []);
const chamou = (tipo: "insert" | "rpc", nome: string) => mundo.chamadas.filter((c) => c.tipo === tipo && c.tabela === nome);
const tokenDe = (perfil: string) => ({ authorization: `Bearer tok-${perfil}` });
const prev = (t: unknown, perfil = "Administrador") => app.inject({ method: "POST", url: "/os/importar-pendentes/preview", headers: tokenDe(perfil), payload: { tabela: t } as object });
const conf = (t: unknown, perfil = "Administrador") => app.inject({ method: "POST", url: "/os/importar-pendentes/confirmar", headers: tokenDe(perfil), payload: { tabela: t } as object });
/** Nenhuma cidade criada e nenhuma OS gravada (a auditoria de negação/prévia não conta como gravação de dados). */
const semGravar = () => chamou("insert", "cidades").length === 0 && chamou("rpc", "importar_os_pendentes").length === 0;

/** O que o banco guardaria: a função SQL simulada só registra os números novos (idempotência por numero_origem). */
function simularBanco() {
  const vistos = new Set<string>();
  mundo.rpcs.importar_os_pendentes = (a) => {
    const itens = a.p_itens as { numero_origem: string }[];
    return { data: itens.map((i) => { const nova = !vistos.has(i.numero_origem); vistos.add(i.numero_origem); return { os_numero_origem: i.numero_origem, os_numero: `X-2026-${vistos.size}`, os_criada: nova }; }), error: null };
  };
  mundo.rpcs.os_numeros_origem_existentes = (a) => ({ data: (a.p_numeros as string[]).filter((n) => vistos.has(n)).map((n) => ({ numero_origem: n })), error: null });
  return vistos;
}

beforeEach(() => {
  mundo.reiniciar();
  versaoVigente.mockClear();
  versaoVigente.mockImplementation(async () => ({ id: "11111111-1111-1111-1111-111111111111", versao: VERSAO_DEMO }));
  for (const p of ["Administrador", "Atendente", "Despachante", "Supervisor", "Equipe de campo", "Usuário Chave"]) {
    mundo.tokens[`tok-${p}`] = `uid-${p}`;
    mundo.tabelas.perfis.push({ user_id: `uid-${p}`, nome: p, perfil: p, todas_cidades: false, equipe_id: null });
  }
  mundo.tabelas.configuracoes = [
    { chave: "importacao.textos_nulos", valor: [] },
    { chave: "importacao.regiao", valor: { latMin: -25, latMax: -17, lngMin: -46, lngMax: -38 } },
    { chave: "importacao.padrao_poste", valor: "^[A-Za-z0-9./-]{1,20}$" },
    { chave: "importacao.fuso_horario", valor: "-03:00" },
    { chave: "importacao.tamanho_lote", valor: 200 },
  ];
  mundo.tabelas["cidades"] = [{ id: "BH", nome: "Belo Horizonte", municipio_origem: null }, { id: "CT", nome: "Contagem", municipio_origem: null }];
  simularBanco();
});

app = await criarApp({ logger: false });
afterAll(() => app.close());

describe("acesso", () => {
  it.each(["/os/importar-pendentes/preview", "/os/importar-pendentes/confirmar"])("sem login → 401: %s", async (url) => {
    expect((await app.inject({ method: "POST", url, payload: { tabela: tabela(OS_A) } })).statusCode).toBe(401);
    expect(semGravar()).toBe(true);
  });
  it.each(["Atendente", "Despachante", "Supervisor", "Equipe de campo", "Usuário Chave"])("%s → 403 nas duas rotas, auditado, sem tocar no banco", async (p) => {
    expect((await prev(tabela(OS_A), p)).statusCode).toBe(403);
    expect((await conf(tabela(OS_A), p)).statusCode).toBe(403);
    expect(mundo.tabelas.auditoria.map((a) => a.acao)).toEqual(["negado:importar_pendentes_preview", "negado:importar_pendentes"]);
    expect(semGravar()).toBe(true);
    expect(chamou("rpc", "os_numeros_origem_existentes")).toHaveLength(0);
  });
  it("Administrador → 200", async () => {
    expect((await prev(tabela(OS_A))).statusCode).toBe(200);
  });
  it("a permissão é 'nova' + todas as cidades: Atendente com todas as cidades também passa (cria cidades, então exige o escopo global)", async () => {
    mundo.tabelas.perfis.find((x) => x.user_id === "uid-Atendente")!.todas_cidades = true;
    expect((await prev(tabela(OS_A), "Atendente")).statusCode).toBe(200);
  });
});

describe("corpo inválido e configuração", () => {
  it("sem tabela, com campo extra ou com linhas demais → 400", async () => {
    expect((await app.inject({ method: "POST", url: "/os/importar-pendentes/preview", headers: tokenDe("Administrador"), payload: {} })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/os/importar-pendentes/preview", headers: tokenDe("Administrador"), payload: { tabela: tabela(OS_A), cidade: "BH" } })).statusCode).toBe(400);
    const demais = { cabecalho: CAB, linhas: Array.from({ length: 20_001 }, (_, i) => lin(i + 2, OS_B)) };
    expect((await prev(demais)).statusCode).toBe(400);
  });
  it("cabeçalho sem OSNumero ou sem Localidade → 400 com a coluna que falta", async () => {
    const r = await prev({ cabecalho: ["Localidade"], linhas: [{ linha: 2, valores: ["MURIAE 1-1"] }] });
    expect(r.statusCode).toBe(400);
    expect(r.json().erro).toMatch(/OSNumero/);
  });
  it.each([
    ["ausente", (c: { chave: string }[]) => c.filter((x) => x.chave !== "importacao.padrao_poste")],
    ["lista de nulos fora do formato", (c: Record<string, unknown>[]) => c.map((x) => (x.chave === "importacao.textos_nulos" ? { ...x, valor: "N/A" } : x))],
    ["região invertida", (c: Record<string, unknown>[]) => c.map((x) => (x.chave === "importacao.regiao" ? { ...x, valor: { latMin: 0, latMax: -10, lngMin: 0, lngMax: 1 } } : x))],
    ["padrão de poste inválido", (c: Record<string, unknown>[]) => c.map((x) => (x.chave === "importacao.padrao_poste" ? { ...x, valor: "(" } : x))],
    ["fuso inválido", (c: Record<string, unknown>[]) => c.map((x) => (x.chave === "importacao.fuso_horario" ? { ...x, valor: "BRT" } : x))],
    ["lote 0", (c: Record<string, unknown>[]) => c.map((x) => (x.chave === "importacao.tamanho_lote" ? { ...x, valor: 0 } : x))],
  ])("configuração %s → 500 (recusa, não adivinha) e nada é gravado", async (_nome, mexer) => {
    mundo.tabelas.configuracoes = (mexer as (c: never) => typeof mundo.tabelas.configuracoes)(mundo.tabelas.configuracoes as never);
    expect((await prev(tabela(OS_A))).statusCode).toBe(500);
    expect((await conf(tabela(OS_A))).statusCode).toBe(500);
    expect(semGravar()).toBe(true);
  });
});

describe("prévia: nada é gravado", () => {
  it("conta o que entra, o que sai, avisos, vazios, cidades novas e quais já existem", async () => {
    const vistos = simularBanco();
    vistos.add("EMG-B"); // já importada antes
    const r = await prev(tabela(OS_A, OS_B, OS_C, { OSNumero: "", Localidade: "MURIAE 1-1" }, { OSNumero: "EMG-D", Localidade: "", "Quantidade clientes": "muitos" }));
    expect(r.statusCode).toBe(200);
    const j = r.json();
    expect(j).toMatchObject({ totalLinhas: 5, entram: 3, totalRejeitadas: 2, jaExistentes: 1, tamanhoLote: 200, semCoordenada: 1, comAviso: 0 });
    expect(j.entramLinhas).toEqual([2, 3, 4]);
    expect(j.rejeitadas.map((x: { linha: number; motivo: string }) => [x.linha, x.motivo])).toEqual([[5, "sem número da OS"], [6, "sem município (Localidade vazia ou só com o código final)"]]);
    expect(j.cidades).toMatchObject({ municipios: 2, novas: 2, existentes: 0 });
    expect(j.cidades.exemplosNovas).toEqual([{ municipio: "MURIAE", codigo: "MURIA" }, { municipio: "MURY / NOVA FRIBURGO", codigo: "MURYN" }]);
    expect(j.origemEndereco).toEqual({ informado: 0, derivado_poste: 1, nao_informado: 2 });
    expect(j.vazios.Logradouro).toBe(5);
    expect(j.amostra[0]).toMatchObject({ numeroOrigem: "EMG-A  001/2026", endereco: "Poste 48-160 — MURIAE", clientes: 12 });
    expect(semGravar()).toBe(true); // nem cidades, nem OS
  });
  it("cidade que já tem município de origem não é 'nova'", async () => {
    tab("cidades").push({ id: "MURIA", nome: "MURIAE", municipio_origem: "MURIAE" });
    const j = (await prev(tabela(OS_A, OS_B))).json();
    expect(j.cidades).toMatchObject({ municipios: 1, novas: 0, existentes: 1 });
  });
  it("só as colunas reconhecidas importam: colunas extras do arquivo são ignoradas", async () => {
    const t = { cabecalho: [...CAB, "Observação", "INSPETOR"], linhas: [{ linha: 2, valores: [...lin(2, OS_A).valores, "texto pessoal qualquer", "FULANO"] }] };
    const r = await prev(t);
    expect(r.statusCode).toBe(200);
    expect(JSON.stringify(r.json())).not.toMatch(/FULANO|pessoal qualquer/);
  });
});

describe("confirmar: um lote, atômico e idempotente", () => {
  it("cria as cidades (uma por município), calcula a prioridade pelo motor e grava o lote numa única chamada", async () => {
    const r = await conf(tabela(OS_A, OS_B, OS_C));
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ recebidas: 3, criadas: 3, jaExistentes: 0, cidadesCriadas: 2, rejeitadas: [] });
    // cidades
    const novas = tab("cidades").filter((c) => c.municipio_origem);
    expect(novas.map((c) => [c.id, c.nome, c.municipio_origem, c.ativa])).toEqual([["MURIA", "MURIAE", "MURIAE", true], ["MURYN", "MURY / NOVA FRIBURGO", "MURY / NOVA FRIBURGO", true]]);
    for (const c of novas) expect(c.id).toMatch(/^[A-Z]{2,5}$/);
    // gravação: UMA chamada com os 3 itens
    const g = chamou("rpc", "importar_os_pendentes");
    expect(g).toHaveLength(1);
    const itens = Object.fromEntries(g[0]!.filtros).p_itens as Record<string, unknown>[];
    expect(itens).toHaveLength(3);
    expect(Object.fromEntries(g[0]!.filtros).p_usuario).toBe("uid-Administrador");
    const [a, b] = itens as [Record<string, any>, Record<string, any>]; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(a).toMatchObject({
      numero_origem: "EMG-A  001/2026", cidade_id: "MURIA", municipio: "MURIAE", circuito: "LPD-1", prioridade_legada: "ALTA", clientes: 12,
      tipo_servico: "Poda", familia_ativo: "REDE", endereco: "Poste 48-160 — MURIAE", origem_endereco: "derivado_poste", poste_codigo: "48-160",
      tipo: "Corretiva", fatos: {}, status: "Aguardando despacho", origem_geo: "convertido_utm", prazo_origem: "2026-01-04T00:00:00-03:00",
      versao_pontuacao_id: "11111111-1111-1111-1111-111111111111", regras_versao: 7,
    });
    expect(a.lat).toBeLessThan(-17); expect(a.lng).toBeLessThan(-38);
    // sem coordenada: triagem, geom/lat nulos; vazio = null (nunca 0)
    expect(b).toMatchObject({ lat: null, lng: null, origem_geo: "desconhecido", status: "Em triagem", clientes: null, prazo_origem: null, circuito: null, prioridade_legada: null, endereco: "Endereço não informado — MURIAE", origem_endereco: "nao_informado" });
  });
  it("prazo DESCONHECIDO para o motor: a prioridade vem sem 'Sem prazo' e com os critérios de risco em 'Desconhecido' (58 pontos)", async () => {
    await conf(tabela(OS_A));
    const it0 = (Object.fromEntries(chamou("rpc", "importar_os_pendentes")[0]!.filtros).p_itens as { resultado: { pontos: number; itens: { criterio: string; opcoes: string[]; pontos: number }[] } }[])[0]!;
    const por = (n: string) => it0.resultado.itens.find((i) => i.criterio === n)!;
    expect(por("Prazo-limite (auto)").opcoes).toEqual([]);
    expect(por("Risco à vida")).toMatchObject({ opcoes: ["Desconhecido"], pontos: 15 });
    expect(por("Tempo de espera (auto)").opcoes).toEqual(["Até 1 h"]);
    expect(it0.resultado.pontos).toBe(15 + 10 + 10 + 8 + 10 + 5);
  });
  it("o prazo da planilha é só informativo: mesmo vencido, não vira prazo-limite do Farol", async () => {
    await conf(tabela({ ...OS_B, DataDeadline: "04/01/2026" }));
    const item = (Object.fromEntries(chamou("rpc", "importar_os_pendentes")[0]!.filtros).p_itens as Record<string, unknown>[])[0]!;
    expect(item.prazo_origem).toBe("2026-01-04T00:00:00-03:00");
    expect(item).not.toHaveProperty("prazo_limite");
    expect(item.fatos).toEqual({});
  });
  it("IDEMPOTENTE: reenviar o mesmo lote não cria nada, não cria cidade de novo e devolve 'já existentes'", async () => {
    await conf(tabela(OS_A, OS_B, OS_C));
    const nCidades = tab("cidades").length;
    const r = await conf(tabela(OS_A, OS_B, OS_C));
    expect(r.json()).toMatchObject({ recebidas: 3, criadas: 0, jaExistentes: 3, cidadesCriadas: 0 });
    expect(tab("cidades")).toHaveLength(nCidades);
    expect(chamou("insert", "cidades")).toHaveLength(1);
  });
  it("lote parcialmente novo: só as novas são contadas como criadas", async () => {
    await conf(tabela(OS_A));
    const r = await conf(tabela(OS_A, OS_B));
    expect(r.json()).toMatchObject({ criadas: 1, jaExistentes: 1 });
  });
  it("linhas rejeitadas no lote são devolvidas com linha e motivo; as válidas entram", async () => {
    const r = await conf(tabela(OS_A, { OSNumero: "", Localidade: "MURIAE 1-1" }, OS_B));
    expect(r.json()).toMatchObject({ criadas: 2, rejeitadas: [{ linha: 3, motivo: "sem número da OS" }] });
    expect(Object.fromEntries(chamou("rpc", "importar_os_pendentes")[0]!.filtros).p_itens).toHaveLength(2);
  });
  it("lote só com linhas rejeitadas: 200, nada de cidade nem de gravação", async () => {
    const r = await conf(tabela({ OSNumero: "", Localidade: "" }));
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ criadas: 0, jaExistentes: 0, cidadesCriadas: 0 });
    expect(semGravar()).toBe(true);
  });
  it("lote vazio ou maior que o tamanho configurado → 400", async () => {
    expect((await conf({ cabecalho: CAB, linhas: [] })).statusCode).toBe(400);
    const grande = { cabecalho: CAB, linhas: Array.from({ length: 201 }, (_, i) => lin(i + 2, { OSNumero: `N${i}`, Localidade: "MURIAE 1-1" })) };
    const r = await conf(grande);
    expect(r.statusCode).toBe(400);
    expect(r.json().erro).toMatch(/máximo é 200/);
    expect(semGravar()).toBe(true);
  });
  it("lote exatamente no limite (200) é aceito", async () => {
    const t = { cabecalho: CAB, linhas: Array.from({ length: 200 }, (_, i) => lin(i + 2, { OSNumero: `N${i}`, Localidade: "MURIAE 1-1" })) };
    const r = await conf(t);
    expect(r.json()).toMatchObject({ recebidas: 200, criadas: 200 });
  });
  it("falha ao gravar: 500 que diz que NADA do lote foi gravado e pode ser reenviado; auditoria de sucesso não é gravada", async () => {
    mundo.rpcs.importar_os_pendentes = () => ({ data: null, error: { code: "23502", message: "null value in column endereco" } });
    const r = await conf(tabela(OS_A));
    expect(r.statusCode).toBe(500);
    expect(r.json().erro).toMatch(/Nada deste lote foi gravado/);
    expect(JSON.stringify(r.json())).not.toMatch(/column endereco/); // detalhe do banco não vaza para o cliente
    expect(mundo.tabelas.auditoria.some((a) => a.acao === "os.importar_pendentes")).toBe(false);
  });
  it("sem versão de pontuação publicada: 503 com a mensagem e nenhuma OS gravada", async () => {
    versaoVigente.mockRejectedValue(new Error("Nenhuma versão de pontuação publicada."));
    const r = await conf(tabela(OS_A));
    expect(r.statusCode).toBe(503);
    expect(r.json().erro).toMatch(/Nenhuma versão/);
    expect(chamou("rpc", "importar_os_pendentes")).toHaveLength(0);
  });
  it("corrida entre importações: colisão ao criar a cidade (23505) → replaneja e conclui", async () => {
    mundo.errosDeInsert["cidades"] = [{ code: "23505", message: "duplicate key" }];
    tab("cidades").push({ id: "MURIA", nome: "MURIAE", municipio_origem: "MURIAE" }); // a outra importação já criou
    const r = await conf(tabela(OS_B));
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject({ criadas: 1 });
  });
  it("erro que não é colisão ao criar a cidade: 500 e nada é gravado", async () => {
    mundo.errosDeInsert["cidades"] = [{ code: "XX000", message: "falha" }];
    expect((await conf(tabela(OS_B))).statusCode).toBe(500);
    expect(chamou("rpc", "importar_os_pendentes")).toHaveLength(0);
  });
  it("auditoria do lote: quem, quantas criadas, já existentes, rejeitadas e cidades criadas", async () => {
    await conf(tabela(OS_A, { OSNumero: "", Localidade: "x" }));
    expect(mundo.tabelas.auditoria.at(-1)).toMatchObject({ acao: "os.importar_pendentes", usuario: "uid-Administrador", detalhe: { recebidas: 2, criadas: 1, jaExistentes: 0, rejeitadas: 1, cidadesCriadas: 1 } });
  });
  it("distribuição de prioridade do lote (todas as OS sem respostas caem no mesmo código)", async () => {
    const r = await conf(tabela(OS_A, OS_B, OS_C));
    expect(r.json().prioridadePorCodigo).toEqual({ "1": 3 });
  });
});
