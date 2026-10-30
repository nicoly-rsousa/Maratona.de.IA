import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { mundo } from "../test/fake-db.js";

vi.mock("../db.js", async () => ({ db: (await import("../test/fake-db.js")).fakeDb }));
const { criarApp } = await import("../app.js");

let app: FastifyInstance;

beforeEach(() => {
  mundo.reiniciar();
  mundo.tokens.admin = "uid-admin";
  mundo.tabelas.perfis.push({ user_id: "uid-admin", nome: "Admin", perfil: "Administrador", todas_cidades: true, equipe_id: null });
  mundo.tabelas.ordens_servico = [
    { id: "os-1", numero: "OS-1", cidade_id: "BH", circuito: "LPD-1", tipo: "Corretiva", status: "Aberta", nivel: 1, codigo: 2, pontos: 10, prazo_limite: null, aberta_em: "2026-01-01T00:00:00Z", lat: -21.5, lng: -42.6 },
    { id: "os-2", numero: "OS-2", cidade_id: "BH", circuito: "LPD-2", tipo: "Corretiva", status: "Aberta", nivel: 2, codigo: 2, pontos: 10, prazo_limite: null, aberta_em: "2026-01-02T00:00:00Z", lat: -21.6, lng: -42.7 },
    { id: "os-3", numero: "OS-3", cidade_id: "BH", circuito: null, tipo: "Corretiva", status: "Aberta", nivel: 1, codigo: 3, pontos: 10, prazo_limite: null, aberta_em: "2026-01-03T00:00:00Z", lat: null, lng: null },
    { id: "os-4", numero: "OS-4", cidade_id: "UB", circuito: "OUTRO", tipo: "Corretiva", status: "Aberta", nivel: 1, codigo: 0, pontos: 10, prazo_limite: null, aberta_em: "2026-01-04T00:00:00Z", lat: -21.7, lng: -42.8 },
  ];
});

app = await criarApp({ logger: false });
afterAll(() => app.close());

const get = (url: string) => app.inject({ method: "GET", url, headers: { authorization: "Bearer admin" } });

describe("filtro de alimentador nas consultas operacionais", () => {
  it("lista apenas circuitos e OS sem circuito da cidade consultada", async () => {
    const r = await get("/os/alimentadores?cidade=BH");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ circuitos: ["LPD-1", "LPD-2"], sem_alimentador: true });
  });

  it("filtra a fila sem recalcular as posições da cidade", async () => {
    const r = await get("/os/fila?cidade=BH&alimentador=LPD-1");
    expect(r.statusCode).toBe(200);
    expect(r.json()).toMatchObject([{ numero: "OS-1", posicao: 2 }]);
  });

  it("filtra o mapa por alimentador e mantém a OS sem circuito selecionável", async () => {
    const circuito = await get("/mapa?cidade=BH&alimentador=LPD-1");
    expect(circuito.statusCode).toBe(200);
    expect(circuito.json().os.map((o: { num: string }) => o.num)).toEqual(["OS-1"]);

    const semCircuito = await get("/mapa?cidade=BH&sem_alimentador=true");
    expect(semCircuito.statusCode).toBe(200);
    expect(semCircuito.json().os.map((o: { num: string }) => o.num)).toEqual(["OS-3"]);
  });

  it("não aceita os dois modos de filtro ao mesmo tempo", async () => {
    const r = await get("/os/fila?cidade=BH&alimentador=LPD-1&sem_alimentador=true");
    expect(r.statusCode).toBe(400);
  });
});
