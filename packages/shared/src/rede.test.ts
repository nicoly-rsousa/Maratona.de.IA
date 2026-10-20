import { describe, expect, it } from "vitest";
import {
  CORES_TRECHO, ajustarRaioDoSlider, codigoDaPrioridadeLegada, contornoAproximado, corDoTrecho, distanciaM, nomeTipoUnidade,
  perfilVeRede, segmentoVisivel, validarRaio, type MapaPrioridadeLegada,
} from "./index";

// Mesmo conteúdo que a migração 0009 grava em configuracoes (demonstrativo).
const MAPA: MapaPrioridadeLegada = {
  EMERGENCIAL: 0, URGENTE: 1, "<2 DIAS": 1, "<4 HORAS": 1, "<5 DIAS": 2, ALTA: 2, "<15 DIAS": 3, "<30 DIAS": 3, BAIXA: 4, "<90 DIAS": 4,
};
const CFG = { raioPadraoM: 1000, raioMaxM: 5000 };

describe("cores do traçado (pelo campo trecho)", () => {
  it("usa as cores da visão Sentinela", () => {
    expect(CORES_TRECHO).toEqual({ 1: "#e31a1c", 2: "#121dd9", 3: "#069e17", 4: "#ff7f00" });
    expect(corDoTrecho(1)).toBe("#e31a1c");
    expect(corDoTrecho("2")).toBe("#121dd9");
    expect(corDoTrecho(4)).toBe("#ff7f00");
  });
  it("segmento LV de trecho 3 fica verde (como no KML original)", () => {
    expect(corDoTrecho(3)).toBe("#069e17");
  });
  it("trecho desconhecido não recebe a cor de nenhum trecho", () => {
    expect(Object.values(CORES_TRECHO)).not.toContain(corDoTrecho(9));
    expect(corDoTrecho(null)).toBe(corDoTrecho(undefined));
  });
});

describe("baixa tensão liga/desliga pela REDE, não pelo trecho", () => {
  it("MV sempre visível; LV só com a opção", () => {
    expect(segmentoVisivel({ rede: "MV" }, false)).toBe(true);
    expect(segmentoVisivel({ rede: "LV" }, false)).toBe(false);
    expect(segmentoVisivel({ rede: "LV" }, true)).toBe(true);
  });
  it("LV com trecho 3 também some por padrão (e MV com trecho 4, se existisse, não)", () => {
    expect(segmentoVisivel({ rede: "LV", trecho: 3 } as never, false)).toBe(false);
    expect(segmentoVisivel({ rede: "MV", trecho: 4 } as never, false)).toBe(true);
  });
});

describe("nome legível do tipo de chave (TIPOUNIDADE)", () => {
  it("remove a sigla", () => {
    expect(nomeTipoUnidade("FU - Chave Fusível")).toBe("Chave Fusível");
    expect(nomeTipoUnidade("CA - Seccionalizador")).toBe("Seccionalizador");
    expect(nomeTipoUnidade("FR - Chave Fusível Religadora")).toBe("Chave Fusível Religadora");
  });
  it("sem o padrão, mantém; vazio é 'não informado' (nunca string vazia)", () => {
    expect(nomeTipoUnidade("Religador")).toBe("Religador");
    expect(nomeTipoUnidade("")).toBe("Tipo não informado");
    expect(nomeTipoUnidade(null)).toBe("Tipo não informado");
  });
});

describe("prioridade legada → código do Farol (informativa)", () => {
  it("mapa demonstrativo completo", () => {
    expect(codigoDaPrioridadeLegada("EMERGENCIAL", MAPA)).toBe(0);
    expect(codigoDaPrioridadeLegada("URGENTE", MAPA)).toBe(1);
    expect(codigoDaPrioridadeLegada("<2 DIAS", MAPA)).toBe(1);
    expect(codigoDaPrioridadeLegada("<5 DIAS", MAPA)).toBe(2);
    expect(codigoDaPrioridadeLegada("ALTA", MAPA)).toBe(2);
    expect(codigoDaPrioridadeLegada("<15 DIAS", MAPA)).toBe(3);
    expect(codigoDaPrioridadeLegada("<30 DIAS", MAPA)).toBe(3);
    expect(codigoDaPrioridadeLegada("BAIXA", MAPA)).toBe(4);
  });
  it('"<4 HORAS" → Urgente (1) e "<90 DIAS" → Baixa (4)', () => {
    expect(codigoDaPrioridadeLegada("<4 HORAS", MAPA)).toBe(1);
    expect(codigoDaPrioridadeLegada("<90 DIAS", MAPA)).toBe(4);
  });
  it("código realmente novo ou vazio → null (sem mapa), nunca 0", () => {
    expect(codigoDaPrioridadeLegada("<1 SEMANA", MAPA)).toBeNull();
    expect(codigoDaPrioridadeLegada("", MAPA)).toBeNull();
    expect(codigoDaPrioridadeLegada(null, MAPA)).toBeNull();
    expect(codigoDaPrioridadeLegada("toString", MAPA)).toBeNull();
  });
  it("valor inválido no mapa (fora de 0–4) vira null", () => {
    expect(codigoDaPrioridadeLegada("X", { X: 9 })).toBeNull();
    expect(codigoDaPrioridadeLegada("X", { X: 1.5 })).toBeNull();
  });
});

describe("raio", () => {
  it("padrão 1 km quando não informado", () => {
    expect(validarRaio(undefined, CFG)).toEqual({ ok: true, raioM: 1000 });
    expect(validarRaio(null, CFG)).toEqual({ ok: true, raioM: 1000 });
  });
  it("aceita até o máximo e recusa acima", () => {
    expect(validarRaio(5000, CFG)).toEqual({ ok: true, raioM: 5000 });
    expect(validarRaio(5001, CFG).ok).toBe(false);
  });
  it("recusa zero, negativo e não numérico", () => {
    for (const v of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) expect(validarRaio(v, CFG).ok).toBe(false);
  });
  it("padrão nunca passa do máximo configurado", () => {
    expect(validarRaio(undefined, { raioPadraoM: 1000, raioMaxM: 500 })).toEqual({ ok: true, raioM: 500 });
  });
  it("slider fica dentro dos limites", () => {
    expect(ajustarRaioDoSlider(99999, CFG)).toBe(5000);
    expect(ajustarRaioDoSlider(-5, CFG)).toBe(100);
    expect(ajustarRaioDoSlider(1234.6, CFG)).toBe(1235);
    expect(ajustarRaioDoSlider(Number.NaN, CFG)).toBe(1000);
  });
});

describe("busca por raio: ordem (lng, lat)", () => {
  // O SQL usa ST_MakePoint(lng, lat) [x = longitude, y = latitude]. Aqui garantimos que o par de pontos
  // de teste distingue as duas ordens: trocar lat/lng muda a distância de ~1 km para centenas de km.
  const A = { lat: -22.268155, lng: -42.459386 }; // chave real da base (EPSG:31983 → graus)
  const aoNorte1km = { lat: A.lat + 1000 / 111_194.93, lng: A.lng };
  it("o par de teste está a ~1.000 m em linha reta", () => {
    expect(Math.abs(distanciaM(A, aoNorte1km) - 1000)).toBeLessThan(1);
  });
  it("com lat/lng trocados a distância fica absurda (o teste pegaria a inversão)", () => {
    const trocado = (p: { lat: number; lng: number }) => ({ lat: p.lng, lng: p.lat });
    expect(distanciaM(trocado(A), trocado(aoNorte1km))).not.toBeCloseTo(1000, -1);
  });
  it("raio de 1 km: a 990 m está dentro e a 1.010 m está fora", () => {
    const a = (m: number) => ({ lat: A.lat + m / 111_194.93, lng: A.lng });
    expect(distanciaM(A, a(990))).toBeLessThanOrEqual(1000);
    expect(distanciaM(A, a(1010))).toBeGreaterThan(1000);
  });
});

describe("perfis com acesso à rede", () => {
  const lista = ["Administrador", "Supervisor", "Despachante", "Atendente", "Usuário Chave"];
  it("Equipe de campo fica de fora por padrão; Atendente entra", () => {
    expect(perfilVeRede("Equipe de campo", lista)).toBe(false);
    expect(perfilVeRede("Atendente", lista)).toBe(true);
  });
});

describe("contorno aproximado", () => {
  it("menos de 3 chaves: só pontos, sem polígono", () => {
    expect(contornoAproximado([])).toEqual({ tipo: "pontos", pontos: [] });
    expect(contornoAproximado([{ lat: 1, lng: 1 }])).toEqual({ tipo: "pontos", pontos: [{ lat: 1, lng: 1 }] });
    const dois = contornoAproximado([{ lat: 1, lng: 1 }, { lat: 2, lng: 2 }]);
    expect(dois.tipo).toBe("pontos");
  });
  it("pontos repetidos contam uma vez (3 chaves no mesmo lugar não formam polígono)", () => {
    const c = contornoAproximado([{ lat: 1, lng: 1 }, { lat: 1, lng: 1 }, { lat: 1, lng: 1 }]);
    expect(c.tipo).toBe("pontos");
    expect(c.tipo === "pontos" && c.pontos).toHaveLength(1);
  });
  it("3 pontos colineares: só pontos", () => {
    const c = contornoAproximado([{ lat: 0, lng: 0 }, { lat: 1, lng: 1 }, { lat: 2, lng: 2 }]);
    expect(c.tipo).toBe("pontos");
  });
  it("envoltória convexa ignora pontos internos", () => {
    const c = contornoAproximado([
      { lat: 0, lng: 0 }, { lat: 0, lng: 4 }, { lat: 4, lng: 4 }, { lat: 4, lng: 0 }, { lat: 2, lng: 2 }, { lat: 1, lng: 3 },
    ]);
    expect(c.tipo).toBe("poligono");
    if (c.tipo === "poligono") {
      expect(c.vertices).toHaveLength(4);
      expect(c.vertices).not.toContainEqual({ lat: 2, lng: 2 });
    }
  });
  it("ignora coordenadas inválidas", () => {
    const c = contornoAproximado([{ lat: Number.NaN, lng: 1 }, { lat: 0, lng: 0 }, { lat: 0, lng: 1 }]);
    expect(c.tipo).toBe("pontos");
  });
});
