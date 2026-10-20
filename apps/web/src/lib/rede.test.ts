import { describe, expect, it } from "vitest";
import { ApiError } from "./api";
import {
  AVISO_SEM_CIRCUITO, CACHE_OS_MS, COR_SEM_MAPA, cacheExpirado, estiloDaPrioridade, exigeNovoLogin, filtrarTracado, formatarClientes, formatarMetros,
  legendaDeChaves, legendaDePrioridades, mensagemDaSugestao, mensagemDeAcessoRede, raioDoCirculoTransformador, resumirTransformadores,
  resumoDeClientes, semCircuitoIdentificado, statusDoErro, temPosicao, textoDataImportacao, textoSemPosicao,
} from "./rede";
import type { FeicaoChave, FeicaoLinha, OSRedeLeve, Tracado, TransformadorRede } from "./rede-api";

const os = (numero: string, extra: Partial<OSRedeLeve> = {}): OSRedeLeve => ({
  numero, circuito: "LPD-1", circuito_origem: "importado", lat: -21.5, lng: -42.6, municipio: "X", prioridade_legada: "ALTA",
  prioridade_codigo: 2, prazo: null, tipo_servico: null, ...extra,
});

describe("estiloDaPrioridade", () => {
  it.each([[0, "Emergente"], [1, "Urgente"], [2, "Alta"], [3, "Média"], [4, "Baixa"]])("código %s → %s, com a variável --c%s do tema", (c, rotulo) => {
    const e = estiloDaPrioridade(c);
    expect(e).toEqual({ chave: `c${c}`, variavelCss: `--c${c}`, rotulo, semMapa: false });
  });
  it.each([[null], [undefined], [-1], [5], [1.5], [Number.NaN]])("%s → SEM MAPA (nunca vira 0)", (c) => {
    const e = estiloDaPrioridade(c as number | null | undefined);
    expect(e).toEqual({ chave: "sem-mapa", variavelCss: null, rotulo: "Sem mapa", semMapa: true });
    expect(e.chave).not.toBe("c0");
  });
  it("o cinza de 'sem mapa' é fixo e distinto do contorno do tema", () => {
    expect(COR_SEM_MAPA).toBe("#888888");
  });
});

describe("legendaDePrioridades", () => {
  it("as 5 classes e 'sem mapa' sempre aparecem, mesmo com zero OS", () => {
    const l = legendaDePrioridades([]);
    expect(l.map((i) => i.chave)).toEqual(["c0", "c1", "c2", "c3", "c4", "sem-mapa"]);
    expect(l.every((i) => i.qtd === 0)).toBe(true);
  });
  it("conta por classe; null e fora da faixa vão para 'sem mapa'", () => {
    const l = legendaDePrioridades([{ prioridade_codigo: 0 }, { prioridade_codigo: 0 }, { prioridade_codigo: 4 }, { prioridade_codigo: null }, { prioridade_codigo: 9 }]);
    expect(Object.fromEntries(l.map((i) => [i.chave, i.qtd]))).toEqual({ c0: 2, c1: 0, c2: 0, c3: 0, c4: 1, "sem-mapa": 2 });
  });
});

describe("semCircuitoIdentificado", () => {
  it("separa as OS com circuito não identificado (inclusive vazio) sem descartar nenhuma", () => {
    const todas = [os("A"), os("B", { circuito: "CQT1-CQT", circuito_origem: "nao_identificado" }), os("C", { circuito: null, circuito_origem: "nao_identificado" }), os("D", { circuito: null, circuito_origem: null })];
    expect(semCircuitoIdentificado(todas).map((o) => o.numero)).toEqual(["B", "C", "D"]);
    expect(todas).toHaveLength(4);
  });
  it("o aviso combinado fala em não corrigir automaticamente", () => {
    expect(AVISO_SEM_CIRCUITO).toMatch(/Não é corrigido automaticamente/);
  });
});

describe("formatação", () => {
  it("clientes: milhar em pt-BR; null → 'desconhecido' (nunca 0); 0 real continua 0", () => {
    expect(formatarClientes(751713)).toBe((751713).toLocaleString("pt-BR"));
    expect(formatarClientes(null)).toBe("desconhecido");
    expect(formatarClientes(undefined)).toBe("desconhecido");
    expect(formatarClientes(0)).toBe("0");
  });
  it("resumo do circuito com nulos preservados", () => {
    expect(resumoDeClientes({ clientes_total: null, clientes_ligados: null, clientes_desligados: null })).toEqual({ total: "desconhecido", ligados: "desconhecido", desligados: "desconhecido" });
    expect(resumoDeClientes({ clientes_total: 10, clientes_ligados: 7, clientes_desligados: 0 })).toEqual({ total: "10", ligados: "7", desligados: "0" });
  });
  it.each([[850, "850 m"], [999.4, "999 m"], [999.6, "1 km"], [1000, "1 km"], [1500, "1,5 km"], [5000, "5 km"], [1234, "1,2 km"]])("%s m → %s", (m, txt) => {
    expect(formatarMetros(m).replace(/ /g, " ")).toBe(txt.replace(/ /g, " "));
  });
  it("valor inválido → travessão", () => expect(formatarMetros(Number.NaN)).toBe("—"));
  it("data da importação em pt-BR, no fuso informado", () => {
    expect(textoDataImportacao("2026-10-19T04:00:00Z", "America/Sao_Paulo")).toBe("dados importados em 19/10/2026 às 01:00");
    expect(textoDataImportacao(null)).toBe("data da importação desconhecida");
    expect(textoDataImportacao("lixo")).toBe("data da importação desconhecida");
  });
});

describe("cache de 5 minutos de /rede/os", () => {
  it("nunca carregado → expirado; antes de 5 min válido; a partir de 5 min expira", () => {
    expect(CACHE_OS_MS).toBe(300_000);
    expect(cacheExpirado(null, 1000)).toBe(true);
    expect(cacheExpirado(1000, 1000 + CACHE_OS_MS - 1)).toBe(false);
    expect(cacheExpirado(1000, 1000 + CACHE_OS_MS)).toBe(true);
  });
});

describe("traçado e chaves", () => {
  const f = (rede: string, trecho: number): FeicaoLinha => ({ type: "Feature", geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] }, properties: { id: `${rede}${trecho}`, rede, uso: null, trecho, dono: null } });
  const t: Tracado = { type: "FeatureCollection", features: [f("MV", 1), f("MV", 3), f("LV", 3), f("LV", 4)] };
  it("baixa tensão desligada: só MV (pela REDE); ligada: todos", () => {
    expect(filtrarTracado(t, false).map((x) => x.properties.id)).toEqual(["MV1", "MV3"]);
    expect(filtrarTracado(t, true)).toHaveLength(4);
    expect(filtrarTracado(undefined, true)).toEqual([]);
  });
  it("o segmento LV de trecho 3 some junto com a baixa tensão (não é tratado como MV)", () => {
    expect(filtrarTracado(t, false).some((x) => x.properties.rede === "LV")).toBe(false);
  });
  const c = (tipo_unidade: string | null): FeicaoChave => ({ type: "Feature", geometry: { type: "Point", coordinates: [0, 0] }, properties: { tipo: null, tipo_unidade, numero_operativo: null } });
  it("legenda das chaves pelo NOME do tipo, da mais numerosa para a menos", () => {
    const l = legendaDeChaves([c("FU - Chave Fusível"), c("CF - Chave Faca"), c("FU - Chave Fusível"), c(null), c("  ")]);
    expect(l).toEqual([{ nome: "Chave Fusível", qtd: 2 }, { nome: "Tipo não informado", qtd: 2 }, { nome: "Chave Faca", qtd: 1 }].sort((a, b) => b.qtd - a.qtd || a.nome.localeCompare(b.nome, "pt-BR")));
    expect(legendaDeChaves(undefined)).toEqual([]);
  });
});

describe("transformadores", () => {
  const t = (transformador: string, clientes: number, lat: number | null, lng: number | null): TransformadorRede => ({ transformador, clientes, ligados: clientes, lat, lng });
  it("resumo: posição só quando lat e lng existem; clientes identificados somados", () => {
    const r = resumirTransformadores([t("A", 10, -1, -2), t("B", 5, null, null), t("C", 7, -1, null)]);
    expect(r).toEqual({ total: 3, comPosicao: 1, semPosicao: 2, clientesIdentificados: 22 });
    expect(resumirTransformadores(undefined)).toEqual({ total: 0, comPosicao: 0, semPosicao: 0, clientesIdentificados: 0 });
  });
  it("temPosicao não confunde 0 com ausente", () => {
    expect(temPosicao({ lat: 0, lng: 0 })).toBe(true);
    expect(temPosicao({ lat: null, lng: 0 })).toBe(false);
  });
  it("texto de 'sem posição' no singular e no plural", () => {
    expect(textoSemPosicao(1)).toBe("1 transformador sem posição");
    expect(textoSemPosicao(46283).replace(/ /g, " ")).toBe(`${(46283).toLocaleString("pt-BR")} transformadores sem posição`.replace(/ /g, " "));
  });
  it("raio do círculo: cresce com os clientes e fica entre 6 e 22 px", () => {
    expect(raioDoCirculoTransformador(0)).toBe(6);
    expect(raioDoCirculoTransformador(-5)).toBe(6);
    expect(raioDoCirculoTransformador(Number.NaN)).toBe(6);
    expect(raioDoCirculoTransformador(100)).toBeGreaterThan(raioDoCirculoTransformador(4));
    expect(raioDoCirculoTransformador(10_000_000)).toBe(22);
  });
});

describe("mensagemDaSugestao: um texto claro para cada status", () => {
  it("201 confirma e deixa claro que nada foi designado", () => {
    const m = mensagemDaSugestao(201);
    expect(m.tipo).toBe("ok");
    expect(m.texto).toMatch(/Nenhuma equipe foi designada/);
  });
  it("409 é aviso e cita o par simétrico", () => {
    const m = mensagemDaSugestao(409);
    expect(m.tipo).toBe("aviso");
    expect(m.texto).toMatch(/A→B e B→A/);
  });
  it("422 e 400 repetem o motivo da API", () => {
    expect(mensagemDaSugestao(422, "A OS sugerida está fora do raio informado.").texto).toMatch(/fora do raio informado/);
    expect(mensagemDaSugestao(400, "Uma OS não pode sugerir a si mesma.").texto).toMatch(/si mesma/);
    expect(mensagemDaSugestao(422).tipo).toBe("erro");
  });
  it("403, 401, 404 e falha de rede", () => {
    expect(mensagemDaSugestao(403).texto).toMatch(/perfil não pode/);
    expect(mensagemDaSugestao(401).texto).toMatch(/sessão expirou/);
    expect(mensagemDaSugestao(404).texto).toMatch(/não encontrada/);
    expect(mensagemDaSugestao(0).texto).toMatch(/servidor/);
    expect(mensagemDaSugestao(500, "falhou").texto).toBe("Erro 500: falhou");
    expect(mensagemDaSugestao(500).texto).toBe("Erro 500.");
  });
  it("todo status devolve algum texto e tipo", () => {
    for (const s of [201, 409, 422, 400, 403, 401, 404, 0, 500]) {
      const m = mensagemDaSugestao(s);
      expect(m.texto.length).toBeGreaterThan(5);
      expect(["ok", "aviso", "erro"]).toContain(m.tipo);
    }
  });
});

describe("acesso ao módulo e erros", () => {
  it("403 explica que o acesso é definido pela administração e que foi registrado", () => {
    const m = mensagemDeAcessoRede(403);
    expect(m.tipo).toBe("erro");
    expect(m.texto).toMatch(/não tem acesso ao Mapa da rede/);
    expect(m.texto).toMatch(/administração/);
  });
  it("401 pede novo login; demais usam a mensagem da API", () => {
    expect(mensagemDeAcessoRede(401).texto).toMatch(/Entre novamente/);
    expect(mensagemDeAcessoRede(500, "Falha ao consultar").texto).toBe("Falha ao consultar");
    expect(mensagemDeAcessoRede(500).texto).toBe("Erro 500.");
  });
  it("statusDoErro lê ApiError; qualquer outro erro vale 0; 401 exige novo login", () => {
    expect(statusDoErro(new ApiError(403, "x"))).toBe(403);
    expect(statusDoErro(new Error("x"))).toBe(0);
    expect(statusDoErro("texto")).toBe(0);
    expect(exigeNovoLogin(new ApiError(401, "x"))).toBe(true);
    expect(exigeNovoLogin(new ApiError(403, "x"))).toBe(false);
  });
});
