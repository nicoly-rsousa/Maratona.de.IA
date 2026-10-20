import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.fn(async (_path: string) => ({}));
const apiPost = vi.fn(async (_path: string, _corpo: unknown) => ({}));
vi.mock("./api", () => ({ api: (p: string) => api(p), apiPost: (p: string, c: unknown) => apiPost(p, c) }));

const { redeApi, chavesRede } = await import("./rede-api");

beforeEach(() => { api.mockClear(); apiPost.mockClear(); });

describe("redeApi: caminhos (todo trecho variável é codificado)", () => {
  it("rotas simples", async () => {
    await redeApi.config(); await redeApi.circuitos(); await redeApi.regionais(); await redeApi.os();
    expect(api.mock.calls.map((c) => c[0])).toEqual(["/rede/config", "/rede/circuitos", "/rede/regionais", "/rede/os"]);
  });
  it("/rede/os com filtros só leva o que foi preenchido", async () => {
    await redeApi.os({ circuito: "LPD-1" });
    await redeApi.os({ regional: "Sul", circuito: "" });
    await redeApi.os({ circuito: "CET-LUM 2" });
    expect(api.mock.calls.map((c) => c[0])).toEqual(["/rede/os?circuito=LPD-1", "/rede/os?regional=Sul", "/rede/os?circuito=CET-LUM+2"]);
  });
  it('código com espaço ("CET-LUM 2") vai codificado em todas as rotas do circuito', async () => {
    await redeApi.circuito("CET-LUM 2"); await redeApi.chaves("CET-LUM 2"); await redeApi.transformadores("CET-LUM 2"); await redeApi.tracado("CET-LUM 2");
    expect(api.mock.calls.map((c) => c[0])).toEqual([
      "/rede/circuitos/CET-LUM%202", "/rede/circuitos/CET-LUM%202/chaves", "/rede/circuitos/CET-LUM%202/transformadores", "/rede/circuitos/CET-LUM%202/tracado",
    ]);
  });
  it("entrada hostil não escapa do segmento da URL", async () => {
    await redeApi.circuito("X/../os?a=1#y");
    expect(api.mock.calls[0]![0]).toBe(`/rede/circuitos/${encodeURIComponent("X/../os?a=1#y")}`);
    expect(api.mock.calls[0]![0]).not.toMatch(/\/\.\.\//);
  });
  it("traçado: baixa tensão só com ?bt=1", async () => {
    await redeApi.tracado("LPD-5"); await redeApi.tracado("LPD-5", false); await redeApi.tracado("LPD-5", true);
    expect(api.mock.calls.map((c) => c[0])).toEqual(["/rede/circuitos/LPD-5/tracado", "/rede/circuitos/LPD-5/tracado", "/rede/circuitos/LPD-5/tracado?bt=1"]);
  });
  it("próximas: número da OS (com espaços e barra) codificado; raio e regional opcionais", async () => {
    await redeApi.proximas("EMG-LDINS3  001100/2026", 1500, "Sul");
    await redeApi.proximas("A");
    expect(api.mock.calls.map((c) => c[0])).toEqual([
      "/rede/os/EMG-LDINS3%20%20001100%2F2026/proximas?raio_m=1500&regional=Sul", "/rede/os/A/proximas",
    ]);
  });
  it("sugerir: POST com o corpo exato, sem campo de usuário (o servidor usa o token)", async () => {
    await redeApi.sugerir({ os_origem: "A", os_sugerida: "B", raio_m: 1000 });
    expect(apiPost).toHaveBeenCalledWith("/rede/sugestoes", { os_origem: "A", os_sugerida: "B", raio_m: 1000 });
  });
});

describe("chavesRede (TanStack Query)", () => {
  it("o que depende do circuito, do traçado BT e do raio entra na chave: só o circuito selecionado é carregado", () => {
    expect(chavesRede.circuito("LPD-1")).not.toEqual(chavesRede.circuito("LPD-2"));
    expect(chavesRede.tracado("LPD-1", false)).not.toEqual(chavesRede.tracado("LPD-1", true));
    expect(chavesRede.proximas("A", 1000)).not.toEqual(chavesRede.proximas("A", 1500));
    expect(chavesRede.proximas("A", 1000)).not.toEqual(chavesRede.proximas("A", 1000, "Sul"));
    expect(chavesRede.os()).not.toEqual(chavesRede.os({ circuito: "LPD-1" }));
    expect(chavesRede.os()).toEqual(chavesRede.os({}));
  });
});
