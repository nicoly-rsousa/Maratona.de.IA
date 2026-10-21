import { describe, expect, it } from "vitest";
import {
  PALETA_CHAVES, ROTULO_CONTORNO_APROXIMADO, buscarCircuitos, circuitoDaOS, contornoDoCircuito, coresDosTiposDeChave, descreverRede, estiloDoSegmento,
  legendaDoTracado, limitesDoCircuito, modoDoPonto, normalizarCodigo, pontosDasChaves, rotuloCompacto, textoDaChave, textoDoContorno, textoDoSegmento,
  textoDoTransformador,
} from "./rede-circuito";
import { chave, circuitoResumo, linhaTracado, trafo } from "@/test/fixtures-rede";
import { estiloDoPonto } from "./rede-mapa";

describe("normalizarCodigo e buscarCircuitos", () => {
  it("ignora caixa, espaço, hífen e acento", () => {
    expect(normalizarCodigo("CET-LUM 2")).toBe("cetlum2");
    expect(normalizarCodigo("cet lum2")).toBe("cetlum2");
    expect(normalizarCodigo("Ítalo-1")).toBe("italo1");
  });
  const lista = [
    circuitoResumo("CET-LUM2", { qtd_os: 3 }), circuitoResumo("CET-LUM 2", { qtd_os: 7 }), circuitoResumo("LPD-1", { qtd_os: 117 }),
    circuitoResumo("LPD-15", { qtd_os: 2 }), circuitoResumo("ALP-1", { qtd_os: 50 }), circuitoResumo("XLPD-1", { qtd_os: 1 }),
  ];
  it('"cetlum2" acha as DUAS grafias (com e sem espaço), a de mais OS primeiro', () => {
    expect(buscarCircuitos(lista, "cetlum2").map((c) => c.codigo)).toEqual(["CET-LUM 2", "CET-LUM2"]);
    expect(buscarCircuitos(lista, "cet lum 2").map((c) => c.codigo)).toEqual(["CET-LUM 2", "CET-LUM2"]);
  });
  it("prefixo vem antes de 'contém'", () => {
    expect(buscarCircuitos(lista, "lpd").map((c) => c.codigo)).toEqual(["LPD-1", "LPD-15", "XLPD-1"]);
  });
  it("sem termo: os circuitos com mais OS; respeita o máximo", () => {
    expect(buscarCircuitos(lista, "", 3).map((c) => c.codigo)).toEqual(["LPD-1", "ALP-1", "CET-LUM 2"]);
    expect(buscarCircuitos(lista, "   ")).toHaveLength(6);
  });
  it("sem resultado → lista vazia; não altera a lista original", () => {
    const copia = [...lista];
    expect(buscarCircuitos(lista, "zzz")).toEqual([]);
    expect(lista).toEqual(copia);
  });
});

describe("circuitoDaOS: nada é corrigido automaticamente", () => {
  const conhecidos = new Set(["LPD-1", "CET-LUM 2"]);
  it("OS importada num circuito conhecido abre esse circuito", () => {
    expect(circuitoDaOS({ circuito: "LPD-1", circuito_origem: "importado" }, conhecidos)).toBe("LPD-1");
  });
  it('OS de circuito NÃO identificado nunca abre circuito, mesmo que o código exista ("CET-LUM 2")', () => {
    expect(circuitoDaOS({ circuito: "CET-LUM 2", circuito_origem: "nao_identificado" }, conhecidos)).toBeNull();
  });
  it("código desconhecido ou vazio → nenhum", () => {
    expect(circuitoDaOS({ circuito: "OUTRO", circuito_origem: "importado" }, conhecidos)).toBeNull();
    expect(circuitoDaOS({ circuito: null, circuito_origem: null }, conhecidos)).toBeNull();
  });
});

describe("modoDoPonto e destaque", () => {
  it("sem circuito selecionado, tudo normal", () => expect(modoDoPonto({ circuito: "A", circuito_origem: "importado" }, null)).toBe("normal"));
  it("OS do alimentador: destaque; as demais: esmaecidas (nunca escondidas)", () => {
    expect(modoDoPonto({ circuito: "A", circuito_origem: "importado" }, "A")).toBe("destaque");
    expect(modoDoPonto({ circuito: "B", circuito_origem: "importado" }, "A")).toBe("esmaecida");
  });
  it("OS de alimentador não identificado não é destacada como do circuito", () => {
    expect(modoDoPonto({ circuito: "A", circuito_origem: "nao_identificado" }, "A")).toBe("esmaecida");
  });
  it("estilo: destaque maior; esmaecida mais transparente; ambos sem perder o anel vazado", () => {
    const o = { prioridade_codigo: 2, circuito: "A", circuito_origem: "importado" as const };
    const normal = estiloDoPonto(o, {});
    expect(estiloDoPonto(o, {}, false, "destaque").radius).toBe(normal.radius + 2);
    expect(estiloDoPonto(o, {}, false, "esmaecida").fillOpacity).toBeLessThan(normal.fillOpacity);
    const anel = estiloDoPonto({ ...o, circuito_origem: "nao_identificado" }, {}, false, "esmaecida");
    expect(anel.fill).toBe(false);
  });
});

describe("traçado por trecho", () => {
  it.each([[1, "#e31a1c"], [2, "#121dd9"], [3, "#069e17"], [4, "#ff7f00"]])("trecho %s → %s", (t, cor) => {
    expect(estiloDoSegmento(linhaTracado("MV", t, "x")).color).toBe(cor);
  });
  it("COR PELO TRECHO, não pela rede: o segmento LV de trecho 3 fica VERDE e o LV de trecho 4 laranja", () => {
    expect(estiloDoSegmento(linhaTracado("LV", 3, "x")).color).toBe("#069e17");
    expect(estiloDoSegmento(linhaTracado("LV", 4, "x")).color).toBe("#ff7f00");
    expect(estiloDoSegmento(linhaTracado("MV", 3, "x")).color).toBe(estiloDoSegmento(linhaTracado("LV", 3, "x")).color);
  });
  it("trecho desconhecido: cinza neutro; baixa tensão mais fina que média tensão", () => {
    expect(estiloDoSegmento(linhaTracado("MV", null, "x")).color).toBe("#888888");
    expect(estiloDoSegmento(linhaTracado("LV", 4, "x")).weight).toBeLessThan(estiloDoSegmento(linhaTracado("MV", 1, "x")).weight);
  });
  it("legenda só dos trechos presentes, em ordem, contando os segmentos de baixa tensão", () => {
    const l = legendaDoTracado([linhaTracado("MV", 2, "a"), linhaTracado("MV", 1, "b"), linhaTracado("LV", 3, "c"), linhaTracado("MV", 3, "d"), linhaTracado("MV", 2, "e")]);
    expect(l.map((i) => [i.rotulo, i.qtd, i.baixaTensao, i.cor])).toEqual([
      ["Trecho 1", 1, 0, "#e31a1c"], ["Trecho 2", 2, 0, "#121dd9"], ["Trecho 3", 2, 1, "#069e17"],
    ]);
    expect(legendaDoTracado([])).toEqual([]);
  });
  it("trecho nulo vira 'Trecho desconhecido' por último", () => {
    expect(legendaDoTracado([linhaTracado("MV", null, "a"), linhaTracado("MV", 1, "b")]).map((i) => i.rotulo)).toEqual(["Trecho 1", "Trecho desconhecido"]);
  });
  it("texto do segmento diz a tensão, o trecho e o id", () => {
    expect(textoDoSegmento(linhaTracado("LV", 3, "ABC"))).toBe("Baixa tensão · trecho 3 · ABC");
    expect(textoDoSegmento(linhaTracado("MV", null, "Z"))).toBe("Média tensão · trecho desconhecido · Z");
  });
});

describe("chaves por tipo", () => {
  it("cor por NOME do tipo, atribuída em ordem alfabética (não muda com a contagem)", () => {
    const a = coresDosTiposDeChave(["Chave Fusível", "Chave Faca", "Chave Fusível"]);
    const b = coresDosTiposDeChave(["Chave Faca", "Chave Fusível", "Chave Fusível", "Chave Fusível"]);
    expect(a).toEqual(b);
    expect(a["Chave Faca"]).toBe(PALETA_CHAVES[0]);
    expect(a["Chave Fusível"]).toBe(PALETA_CHAVES[1]);
  });
  it("a paleta recicla sem falhar quando há mais tipos que cores", () => {
    const nomes = Array.from({ length: PALETA_CHAVES.length + 2 }, (_, i) => `Tipo ${String(i).padStart(2, "0")}`);
    const m = coresDosTiposDeChave(nomes);
    expect(Object.keys(m)).toHaveLength(nomes.length);
    expect(m[nomes[PALETA_CHAVES.length]!]).toBe(PALETA_CHAVES[0]);
  });
  it("a paleta não usa as cores do traçado (não confunde chave com linha)", () => {
    for (const c of ["#e31a1c", "#121dd9", "#069e17", "#ff7f00"]) expect(PALETA_CHAVES as readonly string[]).not.toContain(c);
  });
  it("texto da chave: nome do tipo e número operativo", () => {
    expect(textoDaChave(chave(0, 0, "FU - Chave Fusível", "FU-123"))).toBe("Chave Fusível · FU-123");
    expect(textoDaChave(chave(0, 0, null))).toBe("Tipo não informado");
  });
});

describe("contornoDoCircuito (envoltória aproximada)", () => {
  it("circuito COM traçado: sem contorno (o traçado é desenhado)", () => {
    expect(contornoDoCircuito(true, [chave(0, 0), chave(0, 1), chave(1, 0)])).toBeNull();
  });
  it("sem chaves: nada a desenhar", () => {
    expect(contornoDoCircuito(false, [])).toBeNull();
    expect(contornoDoCircuito(false, undefined)).toBeNull();
  });
  it.each([[1], [2]])("%s chave(s): só pontos, sem polígono", (n) => {
    const c = contornoDoCircuito(false, [chave(-21, -43), chave(-21.5, -43.5)].slice(0, n));
    expect(c?.tipo).toBe("pontos");
  });
  it("3 chaves na MESMA posição contam como 1 ponto distinto: só pontos", () => {
    expect(contornoDoCircuito(false, [chave(-21, -43), chave(-21, -43), chave(-21, -43)])?.tipo).toBe("pontos");
  });
  it("3 chaves COLINEARES: só pontos", () => {
    expect(contornoDoCircuito(false, [chave(0, 0), chave(1, 1), chave(2, 2)])?.tipo).toBe("pontos");
    expect(contornoDoCircuito(false, [chave(5, 0), chave(5, 1), chave(5, 7)])?.tipo).toBe("pontos");
  });
  it("3 chaves não alinhadas: polígono com 3 vértices (lat/lng na ordem certa, apesar de o GeoJSON ser [lng, lat])", () => {
    const c = contornoDoCircuito(false, [chave(-21.0, -43.0), chave(-21.0, -42.0), chave(-22.0, -42.5)]);
    expect(c?.tipo).toBe("poligono");
    if (c?.tipo !== "poligono") return;
    expect(c.vertices).toHaveLength(3);
    for (const v of c.vertices) { expect(v.lat).toBeLessThan(-20); expect(v.lng).toBeLessThan(-40); }
    expect(c.vertices.map((v) => v.lat).sort((a, b) => a - b)).toEqual([-22, -21, -21]);
  });
  it("com pontos internos, o polígono só tem os vértices da envoltória", () => {
    const c = contornoDoCircuito(false, [chave(0, 0), chave(0, 10), chave(10, 10), chave(10, 0), chave(5, 5), chave(3, 4)]);
    expect(c?.tipo === "poligono" && c.vertices.length).toBe(4);
  });
  it("pontosDasChaves converte [lng, lat] em {lat, lng}", () => {
    expect(pontosDasChaves([chave(-21.5, -43.2)])).toEqual([{ lat: -21.5, lng: -43.2 }]);
  });
  it("textos: polígono é rotulado 'aproximado' e 'não é o traçado real'; pontos explicam a ausência do contorno", () => {
    const poli = contornoDoCircuito(false, [chave(0, 0), chave(0, 1), chave(1, 0)]);
    expect(textoDoContorno(poli, 3)).toMatch(/Contorno aproximado/);
    expect(textoDoContorno(poli, 3)).toMatch(/Não é o traçado real/);
    expect(textoDoContorno({ tipo: "pontos", pontos: [] }, 2)).toMatch(/Menos de 3 chaves distintas/);
    expect(textoDoContorno(null, 0)).toBeNull();
    expect(ROTULO_CONTORNO_APROXIMADO).toMatch(/aproximado/);
  });
});

describe("descreverRede: o que a base tem", () => {
  it("com traçado", () => expect(descreverRede({ tem_tracado: true, chaves_qtd: 439 })).toMatchObject({ tracado: true, chaves: 439 }));
  it("sem traçado e com chaves: contorno aproximado, não é o traçado", () => {
    const d = descreverRede({ tem_tracado: false, chaves_qtd: 1114 });
    expect(d.mensagem).toMatch(/aproximado/);
    expect(d.mensagem).toMatch(/não é o traçado real/);
  });
  it("sem traçado e sem chaves (null ou 0): diz que não há rede, nunca 0 inventado", () => {
    for (const q of [null, 0]) expect(descreverRede({ tem_tracado: false, chaves_qtd: q }).mensagem).toMatch(/sem chaves na base/);
  });
});

describe("transformadores no mapa", () => {
  it.each([[0, "0"], [7, "7"], [950, "950"], [999.6, "1000"], [1000, "1k"], [1234, "1,2k"], [9999, "10k"], [12500, "13k"]])("rótulo compacto %s → %s", (n, txt) => {
    expect(rotuloCompacto(n)).toBe(txt);
  });
  it("valores inválidos → 0", () => {
    expect(rotuloCompacto(-3)).toBe("0");
    expect(rotuloCompacto(Number.NaN)).toBe("0");
  });
  it("texto fala em clientes IDENTIFICADOS", () => {
    expect(textoDoTransformador(trafo("T-1", 1500)).replace(/ /g, " ")).toBe("Transformador T-1 · 1.500 clientes identificados (1.500 ligados)");
  });
});

describe("limitesDoCircuito", () => {
  const bbox = { min_lat: -22, min_lng: -43, max_lat: -21, max_lng: -42 };
  it("usa o bbox da lista quando existe", () => {
    expect(limitesDoCircuito({ bbox, os: [{ lat: 10, lng: 10 }], chaves: [], transformadores: [] })).toEqual([[-22, -43], [-21, -42]]);
  });
  it("sem bbox: retângulo de OS, chaves e transformadores com posição (ignora os sem posição)", () => {
    const l = limitesDoCircuito({
      bbox: null, os: [{ lat: -21, lng: -43 }, { lat: null, lng: null }], chaves: [chave(-22, -44)],
      transformadores: [trafo("A", 1, -20, -42), trafo("B", 1, null, null)],
    });
    expect(l).toEqual([[-22, -44], [-20, -42]]);
  });
  it("sem nada: null (o mapa não se mexe)", () => {
    expect(limitesDoCircuito({ bbox: null, os: [], chaves: [], transformadores: [trafo("B", 1, null, null)] })).toBeNull();
  });
});
