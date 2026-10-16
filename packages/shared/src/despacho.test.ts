import { describe, expect, it } from "vitest";
import {
  avaliarEquipe, proximoPasso, recomendarEquipes, urlMapas,
  type EquipeCandidata, type OSParaDespacho,
} from "./despacho";

const os: OSParaDespacho = { cidade: "BH", lat: -19.9167, lng: -43.9345, exigeQualificacao: null };
const eq = (o: Partial<EquipeCandidata> & { id: string }): EquipeCandidata => ({
  cidade: "BH", capacidade: 2, qualificacoes: [], lat: -19.9167, lng: -43.9345, carga: 0, ...o,
});

describe("recomendação de equipes (§9)", () => {
  it("compatibilidade e disponibilidade vêm ANTES da distância", () => {
    const osLv = { ...os, exigeQualificacao: "Linha viva" };
    const lista = recomendarEquipes(osLv, [
      eq({ id: "PERTO-INCOMPAT", lat: -19.9168 }),                                           // ~10 m, sem qualificação
      eq({ id: "LONGE-CHEIA", qualificacoes: ["Linha viva"], carga: 2, lat: -19.9170 }),     // compatível, sem vaga
      eq({ id: "LONGE-OK", qualificacoes: ["Linha viva"], lat: -19.95 }),                    // compatível e disponível, ~3,6 km
    ]);
    expect(lista.map((r) => r.equipe)).toEqual(["LONGE-OK", "LONGE-CHEIA", "PERTO-INCOMPAT"]);
  });

  it("entre equipes equivalentes, a mais próxima vem primeiro; sem coordenada vai para o fim", () => {
    const lista = recomendarEquipes(os, [
      eq({ id: "C", lat: null, lng: null }),
      eq({ id: "B", lat: -19.93 }),
      eq({ id: "A", lat: -19.92 }),
    ]);
    expect(lista.map((r) => r.equipe)).toEqual(["A", "B", "C"]);
    expect(lista[2]!.distanciaM).toBeNull();
  });

  it("por padrão só equipes do município; de outra cidade só como apoio, depois das locais", () => {
    const todas = [eq({ id: "CT-X", cidade: "CT", lat: -19.9167 }), eq({ id: "BH-Y", lat: -19.95 })];
    expect(recomendarEquipes(os, todas).map((r) => r.equipe)).toEqual(["BH-Y"]);
    const com = recomendarEquipes(os, todas, { incluirApoio: true });
    expect(com.map((r) => r.equipe)).toEqual(["BH-Y", "CT-X"]);
    expect(com[1]!.apoioIntermunicipal).toBe(true);
    expect(com[1]!.exigeJustificativaApoio).toBe(true);
    expect(com[0]!.exigeJustificativaApoio).toBe(false);
  });

  it("distância é em linha reta (haversine), arredondada em metros", () => {
    // 0,01° de latitude ≈ 1,11 km
    const r = avaliarEquipe(os, eq({ id: "A", lat: -19.9267 }));
    expect(r.distanciaM).toBeGreaterThan(1100);
    expect(r.distanciaM).toBeLessThan(1120);
    expect(Number.isInteger(r.distanciaM)).toBe(true);
  });

  it("OS sem coordenadas: distância desconhecida, não zero", () => {
    expect(avaliarEquipe({ ...os, lat: null, lng: null }, eq({ id: "A" })).distanciaM).toBeNull();
  });
});

describe("compatibilidade e capacidade", () => {
  it("sem qualificação exigida, qualquer equipe é compatível", () => {
    const r = avaliarEquipe(os, eq({ id: "A" }));
    expect(r.compativel).toBe(true);
    expect(r.exigeExcecao).toBe(false);
    expect(r.motivosIncompatibilidade).toEqual([]);
  });

  it("qualificação ausente: incompatível, exige exceção e diz o motivo", () => {
    const r = avaliarEquipe({ ...os, exigeQualificacao: "Linha viva" }, eq({ id: "A" }));
    expect(r.compativel).toBe(false);
    expect(r.exigeExcecao).toBe(true);
    expect(r.motivosIncompatibilidade[0]).toContain("Linha viva");
  });

  it("capacidade: carga == capacidade é indisponível; carga < capacidade é disponível", () => {
    expect(avaliarEquipe(os, eq({ id: "A", capacidade: 1, carga: 1 })).disponivel).toBe(false);
    expect(avaliarEquipe(os, eq({ id: "A", capacidade: 2, carga: 1 })).disponivel).toBe(true);
    expect(avaliarEquipe(os, eq({ id: "A", capacidade: 2, carga: 3 })).disponivel).toBe(false);
  });

  it("indisponível continua indisponível mesmo sendo compatível e do município (exceção não libera)", () => {
    const r = avaliarEquipe(os, eq({ id: "A", capacidade: 1, carga: 1 }));
    expect(r.compativel).toBe(true);
    expect(r.exigeExcecao).toBe(false);
    expect(r.disponivel).toBe(false);
  });
});

describe("ciclo do despacho", () => {
  it("o próximo passo depende do status da OS", () => {
    expect(proximoPasso("Equipe designada")).toBe("aceite");
    expect(proximoPasso("A caminho")).toBe("inicio");
    expect(proximoPasso("Em execução")).toBe("conclusao");
    expect(proximoPasso("Aguardando recurso")).toBeNull();
    expect(proximoPasso("Aguardando despacho")).toBeNull();
  });
});

describe("link do Maps", () => {
  it("destino por coordenadas, com origem opcional", () => {
    const u = new URL(urlMapas({ lat: -19.9, lng: -43.9 }, { lat: -19.8, lng: -43.8 }));
    expect(u.searchParams.get("destination")).toBe("-19.9,-43.9");
    expect(u.searchParams.get("origin")).toBe("-19.8,-43.8");
    expect(u.searchParams.get("travelmode")).toBe("driving");
    expect(new URL(urlMapas({ lat: 1, lng: 2 })).searchParams.has("origin")).toBe(false);
  });

  it("sem coordenadas, usa o endereço", () => {
    expect(new URL(urlMapas("R. das Acácias, 120 Belo Horizonte")).searchParams.get("destination")).toBe("R. das Acácias, 120 Belo Horizonte");
  });
});
