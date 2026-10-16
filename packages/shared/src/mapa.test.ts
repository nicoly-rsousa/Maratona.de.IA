import { describe, expect, it } from "vitest";
import {
  CIDADE_MAPA_RE, PARAMS_DUPLICIDADE_PADRAO, textoCondicoes, coordenadaDoClique, distanciaM, distanciasAteEquipes, escopoDoMapa, ordenarOSMapa, osNoRaio,
  type EquipeMapa, type OSMapa,
} from "./index";

const BH = { lat: -19.9167, lng: -43.9345 };
const os = (o: Partial<OSMapa> = {}): OSMapa => ({
  id: "o1", num: "BH-2026-0001", cidade: "BH", lat: BH.lat, lng: BH.lng, codigo: 3, nivel: 0, status: "Aguardando despacho", tipo: "Corretiva", ...o,
});
const eq = (e: Partial<EquipeMapa> = {}): EquipeMapa => ({ id: "BH-A", cidade: "BH", lat: BH.lat, lng: BH.lng, capacidade: 2, emUso: 0, ...e });

/** ponto ao norte de BH a `m` metros (1° de latitude ≈ 111,195 km no modelo esférico) */
const aoNorte = (m: number) => ({ lat: BH.lat + m / 111_194.93, lng: BH.lng });

describe("distância em linha reta (haversine)", () => {
  it("é zero no mesmo ponto e simétrica", () => {
    expect(distanciaM(BH, BH)).toBe(0);
    const p = aoNorte(1234);
    expect(distanciaM(BH, p)).toBeCloseTo(distanciaM(p, BH), 6);
  });

  it("confere com valores conhecidos", () => {
    expect(distanciaM(BH, aoNorte(300))).toBeCloseTo(300, 0);
    // 1° de longitude no equador ≈ 111,195 km
    expect(distanciaM({ lat: 0, lng: 0 }, { lat: 0, lng: 1 })).toBeCloseTo(111_195, -1);
    // São Paulo – Rio ≈ 360 km
    const d = distanciaM({ lat: -23.5505, lng: -46.6333 }, { lat: -22.9068, lng: -43.1729 });
    expect(d).toBeGreaterThan(355_000);
    expect(d).toBeLessThan(365_000);
  });
});

describe("distâncias até as equipes", () => {
  it("só da cidade da OS, da mais próxima à mais distante, em metros inteiros", () => {
    const r = distanciasAteEquipes(os(), [
      eq({ id: "BH-B", ...aoNorte(900) }),
      eq({ id: "BH-A", ...aoNorte(250) }),
      eq({ id: "CT-A", cidade: "CT", ...aoNorte(10) }),
    ]);
    expect(r.map((x) => x.equipe.id)).toEqual(["BH-A", "BH-B"]);
    expect(r[0]!.distanciaM).toBe(250);
    expect(Number.isInteger(r[1]!.distanciaM)).toBe(true);
  });

  it("equipe sem coordenada vai por último, sem distância", () => {
    const r = distanciasAteEquipes(os(), [eq({ id: "BH-A", lat: null, lng: null }), eq({ id: "BH-B", ...aoNorte(500) })]);
    expect(r.map((x) => x.equipe.id)).toEqual(["BH-B", "BH-A"]);
    expect(r[1]!.distanciaM).toBeNull();
  });

  it("OS sem coordenadas não tem distância nenhuma (nunca inventa localização)", () => {
    const r = distanciasAteEquipes(os({ lat: null, lng: null }), [eq()]);
    expect(r[0]!.distanciaM).toBeNull();
  });
});

describe("raio de duplicidade", () => {
  it("o padrão é 300 m e o limite é inclusivo", () => {
    expect(PARAMS_DUPLICIDADE_PADRAO.raioM).toBe(300);
    const sel = os();
    const dentro = os({ id: "o2", ...aoNorte(299) });
    const fora = os({ id: "o3", ...aoNorte(301) });
    expect(osNoRaio(sel, [sel, dentro, fora], 300).map((o) => o.id)).toEqual(["o2"]);
    const limite = os({ id: "o4", ...aoNorte(300) });
    expect(osNoRaio(sel, [limite], distanciaM(sel as { lat: number; lng: number }, limite as { lat: number; lng: number })).map((o) => o.id)).toEqual(["o4"]);
  });

  it("respeita o raio recebido, não um valor fixo", () => {
    const sel = os();
    const p = os({ id: "o2", ...aoNorte(500) });
    expect(osNoRaio(sel, [p], 300)).toEqual([]);
    expect(osNoRaio(sel, [p], 600)).toHaveLength(1);
  });

  it("OS selecionada sem coordenadas não tem vizinhas; vizinhas sem coordenadas são ignoradas", () => {
    expect(osNoRaio(os({ lat: null, lng: null }), [os({ id: "o2" })], 300)).toEqual([]);
    expect(osNoRaio(os(), [os({ id: "o2", lat: null, lng: null })], 300)).toEqual([]);
  });
});

describe("escopo do mapa (§8)", () => {
  const dispatcher = { todasCidades: false, cidades: ["BH"] };
  it("cidade do vínculo passa; de outra cidade não", () => {
    expect(escopoDoMapa("BH", dispatcher)).toEqual({ ok: true });
    expect(escopoDoMapa("CT", dispatcher)).toEqual({ ok: false, motivo: "fora_do_escopo" });
  });
  it('"*" só com acesso a todas as cidades', () => {
    expect(escopoDoMapa("*", dispatcher)).toEqual({ ok: false, motivo: "todas_cidades" });
    expect(escopoDoMapa("*", { todasCidades: true, cidades: [] })).toEqual({ ok: true });
    expect(escopoDoMapa("CT", { todasCidades: true, cidades: [] })).toEqual({ ok: true });
  });
  it("valida o formato do parâmetro", () => {
    expect(CIDADE_MAPA_RE.test("BH")).toBe(true);
    expect(CIDADE_MAPA_RE.test("*")).toBe(true);
    expect(["bh", "B", "BH;", "", "BH,CT", "global"].some((c) => CIDADE_MAPA_RE.test(c))).toBe(false);
  });
});

describe("lista da OS no mapa", () => {
  it("precedência, depois código mais urgente, depois número", () => {
    const l = ordenarOSMapa([
      os({ id: "a", num: "BH-2026-0003", nivel: 0, codigo: 1 }),
      os({ id: "b", num: "BH-2026-0002", nivel: 2, codigo: 4 }),
      os({ id: "c", num: "BH-2026-0001", nivel: 0, codigo: 1 }),
      os({ id: "d", num: "BH-2026-0004", nivel: 0, codigo: 0 }),
    ]);
    expect(l.map((o) => o.id)).toEqual(["b", "d", "c", "a"]);
  });
});

describe("ponto clicado no mapa", () => {
  it("arredonda a 6 casas", () => {
    expect(coordenadaDoClique(-19.91670049, -43.93450051)).toEqual({ lat: -19.916700, lng: -43.934501 });
  });
  it("normaliza longitude de outra cópia do mundo", () => {
    expect(coordenadaDoClique(-19.9, 316.0655)!.lng).toBeCloseTo(-43.9345, 4);
    expect(coordenadaDoClique(-19.9, -403.9345)!.lng).toBeCloseTo(-43.9345, 4);
    expect(coordenadaDoClique(0, 180)!.lng).toBe(-180);
  });
  it("rejeita o inválido", () => {
    expect(coordenadaDoClique(91, 0)).toBeNull();
    expect(coordenadaDoClique(-90.1, 0)).toBeNull();
    expect(coordenadaDoClique(Number.NaN, 0)).toBeNull();
    expect(coordenadaDoClique(0, Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("texto das condições de uma regra", () => {
  it("junta as condições com E e as opções com /", () => {
    expect(
      textoCondicoes([
        { criterio: "essencial", criterioNome: "Serviço essencial", opcoes: ["Hospital / emergência"] },
        { criterio: "reserva", criterioNome: "Fonte de reserva", opcoes: ["Não", "Desconhecida"] },
      ]),
    ).toBe("Serviço essencial ∈ Hospital / emergência E Fonte de reserva ∈ Não/Desconhecida");
  });
});
