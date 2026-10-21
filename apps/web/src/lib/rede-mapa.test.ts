import { describe, expect, it } from "vitest";
import { CORES_RESERVA, TRACEJADO_SEM_MAPA, estiloDoPonto, limitesDasOS, temCoordenada, textoDoPonto } from "./rede-mapa";

const base = { prioridade_codigo: 2, circuito: "LPD-1", circuito_origem: "importado" as const };
const cores = { "--c0": "#c4005f", "--c1": "#c93a14", "--c2": "#9a6a00", "--c3": "#1f64c8", "--c4": "#4c675a", "--tx": "#16212c", "--bg": "#eef2f6" };

describe("estiloDoPonto", () => {
  it("OS normal: ponto cheio na cor da classe do tema, contorno contínuo", () => {
    const s = estiloDoPonto(base, cores);
    expect(s).toMatchObject({ fill: true, fillColor: "#9a6a00", dashArray: null, radius: 5 });
  });
  it.each([0, 1, 2, 3, 4])("classe %s usa a variável --c%s do tema ATUAL (claro ou escuro)", (c) => {
    expect(estiloDoPonto({ ...base, prioridade_codigo: c }, cores).fillColor).toBe(cores[`--c${c}` as keyof typeof cores]);
  });
  it("sem as cores do tema usa a reserva em vez de ficar sem cor", () => {
    expect(estiloDoPonto(base, {}).fillColor).toBe(CORES_RESERVA["--c2"]);
  });
  it("SEM MAPA: cinza, contorno TRACEJADO (não depende só da cor) e nunca a cor da classe 0", () => {
    const s = estiloDoPonto({ ...base, prioridade_codigo: null }, cores);
    expect(s.dashArray).toBe(TRACEJADO_SEM_MAPA);
    expect(s.fillColor).toBe("#888888");
    expect(s.fillColor).not.toBe(cores["--c0"]);
  });
  it("circuito NÃO identificado: ANEL VAZADO (sem preenchimento), na cor da classe", () => {
    const s = estiloDoPonto({ ...base, circuito: "CQT1-CQT", circuito_origem: "nao_identificado" }, cores);
    expect(s).toMatchObject({ fill: false, fillOpacity: 0, color: "#9a6a00" });
    expect(s.weight).toBeGreaterThanOrEqual(3);
  });
  it("circuito vazio também vira anel vazado", () => {
    expect(estiloDoPonto({ ...base, circuito: null, circuito_origem: null }, cores).fill).toBe(false);
  });
  it("anel + sem mapa: cinza tracejado e vazado", () => {
    const s = estiloDoPonto({ prioridade_codigo: null, circuito: null, circuito_origem: "nao_identificado" }, cores);
    expect(s).toMatchObject({ fill: false, color: "#888888", dashArray: TRACEJADO_SEM_MAPA });
  });
  it("selecionada: maior, contorno de alto contraste (cor de texto do tema) e contínuo", () => {
    const normal = estiloDoPonto({ ...base, prioridade_codigo: null }, cores);
    const sel = estiloDoPonto({ ...base, prioridade_codigo: null }, cores, true);
    expect(sel.radius).toBe(normal.radius + 4);
    expect(sel.color).toBe(cores["--tx"]);
    expect(sel.dashArray).toBeNull();
    expect(sel.weight).toBeGreaterThan(normal.weight);
  });
  it("as três aparências são distintas entre si (cheio, tracejado, anel)", () => {
    const cheio = estiloDoPonto(base, cores);
    const trac = estiloDoPonto({ ...base, prioridade_codigo: null }, cores);
    const anel = estiloDoPonto({ ...base, circuito_origem: "nao_identificado" }, cores);
    expect(new Set([cheio.fill + String(cheio.dashArray), trac.fill + String(trac.dashArray), anel.fill + String(anel.dashArray)]).size).toBe(3);
  });
});

describe("limitesDasOS e coordenadas", () => {
  it("retângulo das OS com coordenada; ignora as sem coordenada", () => {
    expect(limitesDasOS([{ lat: -21.5, lng: -42.6 }, { lat: -22, lng: -43 }, { lat: null, lng: null }, { lat: -21, lng: -42 }])).toEqual([[-22, -43], [-21, -42]]);
  });
  it("sem nenhuma coordenada → null", () => {
    expect(limitesDasOS([])).toBeNull();
    expect(limitesDasOS([{ lat: null, lng: -1 }])).toBeNull();
  });
  it("coordenada zero é válida; NaN e metade ausente não", () => {
    expect(temCoordenada({ lat: 0, lng: 0 })).toBe(true);
    expect(temCoordenada({ lat: Number.NaN, lng: 1 })).toBe(false);
    expect(temCoordenada({ lat: 1, lng: null })).toBe(false);
  });
});

describe("textoDoPonto", () => {
  it("número, classe informativa, prioridade legada original", () => {
    expect(textoDoPonto({ ...base, numero: "OS-1", prioridade_legada: "ALTA" })).toBe("OS-1 · Alta (legada: ALTA)");
  });
  it("sem mapa e sem circuito deixam o alerta explícito", () => {
    expect(textoDoPonto({ numero: "OS-2", prioridade_codigo: null, prioridade_legada: "NOVA", circuito: "X", circuito_origem: "nao_identificado" }))
      .toBe("OS-2 · Sem mapa (legada: NOVA) · alimentador não identificado");
  });
  it("devolve TEXTO PURO: marcação HTML da planilha não é interpretada (o mapa usa textContent)", () => {
    const t = textoDoPonto({ ...base, numero: "<img src=x onerror=alert(1)>", prioridade_legada: "<b>x</b>" });
    expect(t).toContain("<img src=x onerror=alert(1)>");
  });
});
