import { describe, expect, it } from "vitest";
import { distanciaEntreOS, osProximas, RAIO_OS_PROXIMAS_M } from "./rede-mapa";
import type { OSRedeLeve } from "./rede-api";

const os = (numero: string, lat: number | null, lng: number | null) => ({ numero, lat, lng }) as OSRedeLeve;

describe("OS próximas no mapa da rede", () => {
  it("mede a distância em metros e ignora OS sem coordenada", () => {
    expect(distanciaEntreOS(os("A", 0, 0), os("B", 0.005, 0))).toBeCloseTo(556, -1);
    expect(distanciaEntreOS(os("A", 0, 0), os("sem-local", null, null))).toBeNull();
  });

  it("lista somente as outras OS dentro de 1 km, da mais próxima para a mais distante", () => {
    const origem = os("origem", 0, 0);
    const perto = os("perto", 0.002, 0);
    const fora = os("fora", 0.012, 0);
    const semLocal = os("sem-local", null, null);

    const resultado = osProximas(origem, [origem, fora, semLocal, perto]);

    expect(RAIO_OS_PROXIMAS_M).toBe(1_000);
    expect(resultado.map((x) => x.os.numero)).toEqual(["perto"]);
    expect(resultado[0]!.distanciaM).toBeLessThan(RAIO_OS_PROXIMAS_M);
  });
});
