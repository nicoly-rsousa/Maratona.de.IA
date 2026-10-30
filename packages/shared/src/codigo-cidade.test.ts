import { describe, expect, it } from "vitest";
import { FORMATO_CODIGO_CIDADE, codigoDaCidade } from "./codigo-cidade";

const livre = new Set<string>();

describe("codigoDaCidade: 2 a 5 letras maiúsculas (ck_cidade_id_formato), determinístico e sem colisão", () => {
  it("município simples: as 5 primeiras letras", () => {
    expect(codigoDaCidade("MURIAE", livre)).toBe("MURIA");
  });
  it("tira acento e caixa; ignora pontuação", () => {
    expect(codigoDaCidade("Muriaé", livre)).toBe("MURIA");
    expect(codigoDaCidade("  são joão d'el-rei ", livre)).toBe("SAOJO");
  });
  it("palavras de ligação (DE, DA, DO, DAS, DOS, E) saem quando sobra mais de uma palavra", () => {
    expect(codigoDaCidade("PORTO DE MOZ", livre)).toBe("PORTO");
    expect(codigoDaCidade("SANTA RITA DO SAPUCAI", livre)).toBe("SANTA");
    expect(codigoDaCidade("DE", livre)).toBe("DE");
  });
  it("formato 'DISTRITO / MUNICÍPIO' usa o texto inteiro", () => {
    expect(codigoDaCidade("MURY / NOVA FRIBURGO", livre)).toBe("MURYN");
  });
  it("nome curto: completa com X até 2 letras", () => {
    expect(codigoDaCidade("A", livre)).toBe("AX");
    expect(codigoDaCidade("EL", livre)).toBe("EL");
  });
  it("nome sem letras (só números/símbolos): código genérico válido", () => {
    expect(codigoDaCidade("123", livre)).toMatch(FORMATO_CODIGO_CIDADE);
  });
  it("não repete um código ocupado (BH e CT existentes ficam reservados)", () => {
    expect(codigoDaCidade("BELO HORIZONTE", new Set(["BH", "CT"]))).toBe("BELOH");
    expect(codigoDaCidade("BH", new Set(["BH"]))).not.toBe("BH");
    expect(codigoDaCidade("BH", new Set(["BH"]))).toMatch(FORMATO_CODIGO_CIDADE);
  });
  it("colisão: tenta prefixos menores e depois variações, sempre válido", () => {
    expect(codigoDaCidade("MURIAE", new Set(["MURIA"]))).toBe("MURI");
    expect(codigoDaCidade("MURIAE", new Set(["MURIA", "MURI", "MUR", "MU"]))).toBe("MURIE");
    const c = codigoDaCidade("MURIAE", new Set(["MURIA", "MURI", "MUR", "MU", "MURIE"]));
    expect(c).toMatch(FORMATO_CODIGO_CIDADE);
    expect(["MURIA", "MURI", "MUR", "MU", "MURIE"]).not.toContain(c);
  });
  it("sempre devolve um código livre, mesmo com quase todo o espaço de prefixos ocupado", () => {
    const ocupados = new Set<string>();
    for (const p of ["MURIA", "MURI", "MUR", "MU", "MURIE"]) ocupados.add(p);
    for (let i = 0; i < 300; i++) {
      const c = codigoDaCidade("MURIAE", ocupados);
      expect(c).toMatch(FORMATO_CODIGO_CIDADE);
      expect(ocupados.has(c)).toBe(false);
      ocupados.add(c);
    }
  });
  it("determinístico: mesma entrada, mesmo código", () => {
    const o = new Set(["MURIA"]);
    expect(codigoDaCidade("MURIAE", o)).toBe(codigoDaCidade("MURIAE", o));
    expect(codigoDaCidade("MURIAE", new Set(["MURIA", "MURI", "MUR", "MU", "MURIE"]))).toBe(
      codigoDaCidade("MURIAE", new Set(["MURIE", "MU", "MUR", "MURI", "MURIA"])),
    );
  });
  it("não muda o conjunto recebido", () => {
    const o = new Set(["MURIA"]);
    codigoDaCidade("MURIAE", o);
    expect([...o]).toEqual(["MURIA"]);
  });
  it("500 nomes com o mesmo começo: todos os códigos são distintos e válidos", () => {
    const usados = new Set(["BH", "CT"]);
    for (let i = 0; i < 500; i++) {
      const c = codigoDaCidade(`SAO JOSE ${i}-X${(i * 7919) % 1000}`, usados);
      expect(c).toMatch(FORMATO_CODIGO_CIDADE);
      expect(usados.has(c)).toBe(false);
      usados.add(c);
    }
    expect(usados.size).toBe(502);
  });
  it("o formato exportado é o mesmo da restrição do banco", () => {
    expect(FORMATO_CODIGO_CIDADE.source).toBe("^[A-Z]{2,5}$");
  });
});
