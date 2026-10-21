// Fase 3: seleção de circuito na página /rede, com o mapa MOCKADO (captura o que seria desenhado) e a API mockada.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "@/lib/api";
import type { OSRedeLeve, RedeConfig } from "@/lib/rede-api";
import { chave, chaves, circuitoResumo, linhaTracado, respostaOS, tracado, trafo } from "@/test/fixtures-rede";

const h = vi.hoisted(() => ({
  config: vi.fn(), os: vi.fn(), circuitos: vi.fn(), circuito: vi.fn(), tracado: vi.fn(), chaves: vi.fn(), transformadores: vi.fn(),
  replace: vi.fn(), signOut: vi.fn(async () => ({})),
  mapa: null as null | { onSelecionar: (n: string) => void; circuito: unknown; circuitoDestaque: string | null },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: h.replace }) }));
vi.mock("@/lib/supabase", () => ({ supabase: () => ({ auth: { signOut: h.signOut } }) }));
vi.mock("@/lib/rede-api", async (orig) => ({
  ...(await orig<typeof import("@/lib/rede-api")>()),
  redeApi: { config: h.config, os: h.os, circuitos: h.circuitos, circuito: h.circuito, tracado: h.tracado, chaves: h.chaves, transformadores: h.transformadores },
}));
vi.mock("@/components/rede/mapa-rede", () => ({
  MapaRede: (p: { os: unknown[]; onSelecionar: (n: string) => void; circuito: null | { codigo: string; tracado: unknown[]; chaves: unknown[]; transformadores: unknown[]; contorno: null | { tipo: string }; limites: unknown }; circuitoDestaque: string | null }) => {
    h.mapa = p as never;
    return (
      <div
        data-testid="mapa" role="region" aria-label="Mapa da rede: OS importadas" data-total={p.os.length}
        data-circuito={p.circuito?.codigo ?? ""} data-tracado={p.circuito?.tracado.length ?? -1} data-chaves={p.circuito?.chaves.length ?? -1}
        data-trafos={p.circuito?.transformadores.length ?? -1} data-contorno={p.circuito?.contorno?.tipo ?? ""} data-destaque={p.circuitoDestaque ?? ""}
        data-limites={p.circuito?.limites ? "sim" : "nao"}
      />
    );
  },
}));

const { default: RedePage } = await import("./page");

const CFG: RedeConfig = { raioPadraoM: 1000, raioMaxM: 5000, pode_sugerir: true };
const nb = (s: string | null) => (s ?? "").replace(/ /g, " ");

const osx = (numero: string, circuito: string | null, origem: OSRedeLeve["circuito_origem"] = "importado"): OSRedeLeve => ({
  numero, circuito, circuito_origem: origem, lat: -21.1, lng: -43.0, municipio: "X", prioridade_legada: "ALTA", prioridade_codigo: 2, prazo: null, tipo_servico: "t",
});
const OS = [osx("OS-LPD1", "LPD-1"), osx("OS-LPD5", "LPD-5"), osx("OS-REA", "REA-DOC"), osx("OS-CET", "CET-LUM 2", "nao_identificado"), osx("OS-CQT", "CQT1-CQT", "nao_identificado")];

const LISTA = [
  circuitoResumo("LPD-1", { tem_tracado: true, chaves_qtd: 3, clientes_total: 5683, clientes_ligados: 4715, clientes_desligados: 968, qtd_os: 117, bbox: { min_lat: -21.2, min_lng: -43.1, max_lat: -21.0, max_lng: -42.9 } }),
  circuitoResumo("LPD-5", { tem_tracado: true, chaves_qtd: 4, clientes_total: 2537, qtd_os: 106, bbox: { min_lat: -21.5, min_lng: -42.5, max_lat: -21.4, max_lng: -42.4 } }),
  circuitoResumo("REA-DOC", { chaves_qtd: 5, clientes_total: 7534, qtd_os: 40, bbox: { min_lat: 0, min_lng: 0, max_lat: 1, max_lng: 1 } }),
  circuitoResumo("CET-LUM 2", { chaves_qtd: null, clientes_total: 4106, qtd_os: 7 }),
  circuitoResumo("CT2R1-MRI", { chaves_qtd: 1, bbox: { min_lat: 0, min_lng: 0, max_lat: 0, max_lng: 0 } }),
  circuitoResumo("SMA-PAO", { chaves_qtd: 2, bbox: { min_lat: 0, min_lng: 0, max_lat: 1, max_lng: 1 } }),
  circuitoResumo("COL-3", { chaves_qtd: 3, bbox: { min_lat: 0, min_lng: 0, max_lat: 2, max_lng: 2 } }),
];

const MV = [linhaTracado("MV", 1, "m1"), linhaTracado("MV", 2, "m2"), linhaTracado("MV", 3, "m3")];
const LV = [linhaTracado("LV", 3, "l3"), linhaTracado("LV", 4, "l4")];
const CHAVES: Record<string, ReturnType<typeof chaves>> = {
  "LPD-1": chaves(chave(0, 0, "FU - Chave Fusível"), chave(0, 1, "FU - Chave Fusível"), chave(1, 0, "CF - Chave Faca")),
  "LPD-5": chaves(chave(0, 0), chave(0, 1), chave(1, 0), chave(1, 1)),
  "REA-DOC": chaves(chave(0, 0), chave(0, 10), chave(10, 10), chave(10, 0), chave(5, 5)),
  "CT2R1-MRI": chaves(chave(-21, -43)),
  "SMA-PAO": chaves(chave(-21, -43), chave(-22, -44)),
  "COL-3": chaves(chave(0, 0), chave(1, 1), chave(2, 2)),
};
const TRAFOS: Record<string, ReturnType<typeof trafo>[]> = {
  "LPD-1": [trafo("T1", 100), trafo("T2", 50), trafo("T3", 30, null, null)],
  "CET-LUM 2": [trafo("C1", 1200), trafo("C2", 300), trafo("C3", 10), trafo("C4", 5, null, null)],
};

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(<QueryClientProvider client={qc}><RedePage /></QueryClientProvider>);
}

async function escolher(codigo: string, termo = codigo) {
  fireEvent.change(await screen.findByRole("searchbox"), { target: { value: termo } });
  const botao = screen.getAllByRole("button").find((b) => b.querySelector(".m")?.textContent === codigo);
  if (!botao) throw new Error(`botão do circuito ${codigo} não encontrado na busca`);
  fireEvent.click(botao);
}

beforeEach(() => {
  for (const f of [h.config, h.os, h.circuitos, h.circuito, h.tracado, h.chaves, h.transformadores, h.replace]) f.mockReset();
  h.signOut.mockClear();
  h.mapa = null;
  h.config.mockResolvedValue(CFG);
  h.os.mockResolvedValue(respostaOS(OS));
  h.circuitos.mockResolvedValue({ total: LISTA.length, circuitos: LISTA });
  h.circuito.mockImplementation(async (c: string) => ({
    circuito: { codigo: c }, ordem_informativa: true, aviso_ordem: "", os: OS.filter((o) => o.circuito === c).map((o) => ({ ...o, clientes: null, familia_ativo: null, origem_geo: null })),
  }));
  h.tracado.mockImplementation(async (_c: string, bt = false) => tracado(...MV, ...(bt ? LV : [])));
  h.chaves.mockImplementation(async (c: string) => CHAVES[c] ?? chaves());
  h.transformadores.mockImplementation(async (c: string) => TRAFOS[c] ?? []);
});

const chamadasDeCircuito = () => ({ circuito: h.circuito.mock.calls, tracado: h.tracado.mock.calls, chaves: h.chaves.mock.calls, transformadores: h.transformadores.mock.calls });
const mapa = () => screen.getByTestId("mapa");

describe("só o circuito selecionado é carregado", () => {
  it("sem seleção: a lista de circuitos é pedida, mas NENHUM dado de circuito (traçado, chaves, transformadores)", async () => {
    montar();
    await screen.findByTestId("mapa");
    await screen.findByRole("searchbox");
    expect(h.circuitos).toHaveBeenCalledTimes(1);
    const c = chamadasDeCircuito();
    expect([c.circuito.length, c.tracado.length, c.chaves.length, c.transformadores.length]).toEqual([0, 0, 0, 0]);
    expect(mapa().getAttribute("data-circuito")).toBe("");
    expect(mapa().getAttribute("data-destaque")).toBe("");
  });

  it("escolher LPD-1: pede UMA vez cada dado dele, só dele, e a baixa tensão NÃO", async () => {
    montar();
    await escolher("LPD-1");
    await waitFor(() => expect(mapa().getAttribute("data-tracado")).toBe("3"));
    expect(h.circuito.mock.calls).toEqual([["LPD-1"]]);
    expect(h.tracado.mock.calls).toEqual([["LPD-1", false]]);
    expect(h.chaves.mock.calls).toEqual([["LPD-1"]]);
    expect(h.transformadores.mock.calls).toEqual([["LPD-1"]]);
    expect(mapa().getAttribute("data-circuito")).toBe("LPD-1");
    expect(mapa().getAttribute("data-destaque")).toBe("LPD-1");
    expect(mapa().getAttribute("data-chaves")).toBe("3");
    expect(mapa().getAttribute("data-trafos")).toBe("3");
    expect(mapa().getAttribute("data-contorno")).toBe(""); // tem traçado real: sem contorno aproximado
  });

  it("trocar de circuito carrega só o novo; limpar volta à visão geral sem pedir nada", async () => {
    montar();
    await escolher("LPD-1");
    await waitFor(() => expect(mapa().getAttribute("data-circuito")).toBe("LPD-1"));
    await escolher("LPD-5");
    await waitFor(() => expect(mapa().getAttribute("data-circuito")).toBe("LPD-5"));
    expect(h.circuito.mock.calls).toEqual([["LPD-1"], ["LPD-5"]]);
    const antes = h.circuito.mock.calls.length;
    fireEvent.click(screen.getByText("Limpar seleção"));
    await waitFor(() => expect(mapa().getAttribute("data-circuito")).toBe(""));
    expect(mapa().getAttribute("data-destaque")).toBe("");
    expect(h.circuito.mock.calls).toHaveLength(antes);
  });
});

describe("baixa tensão", () => {
  it("desligada por padrão; ligar busca ?bt=1 e acrescenta a LV; desligar volta à média tensão SEM nova busca", async () => {
    montar();
    await escolher("LPD-1");
    await waitFor(() => expect(mapa().getAttribute("data-tracado")).toBe("3"));
    const cx = screen.getByRole("checkbox", { name: /baixa tensão/i }) as HTMLInputElement;
    expect(cx.checked).toBe(false);
    fireEvent.click(cx);
    await waitFor(() => expect(mapa().getAttribute("data-tracado")).toBe("5"));
    expect(h.tracado.mock.calls).toEqual([["LPD-1", false], ["LPD-1", true]]);
    fireEvent.click(cx);
    await waitFor(() => expect(mapa().getAttribute("data-tracado")).toBe("3"));
    fireEvent.click(cx);
    await waitFor(() => expect(mapa().getAttribute("data-tracado")).toBe("5"));
    expect(h.tracado).toHaveBeenCalledTimes(2); // a segunda vez vem do cache
  });

  it("ao trocar de circuito a caixa volta a ficar desligada e a LV do novo não é pedida", async () => {
    montar();
    await escolher("LPD-1");
    await waitFor(() => expect(mapa().getAttribute("data-tracado")).toBe("3"));
    fireEvent.click(screen.getByRole("checkbox", { name: /baixa tensão/i }));
    await waitFor(() => expect(mapa().getAttribute("data-tracado")).toBe("5"));
    await escolher("LPD-5");
    await waitFor(() => expect(mapa().getAttribute("data-circuito")).toBe("LPD-5"));
    expect((screen.getByRole("checkbox", { name: /baixa tensão/i }) as HTMLInputElement).checked).toBe(false);
    expect(h.tracado.mock.calls.filter(([c, bt]) => c === "LPD-5" && bt === true)).toHaveLength(0);
  });

  it("a baixa tensão filtra pela REDE no cliente: se a API devolvesse LV com a caixa desligada, ela não vai ao mapa", async () => {
    h.tracado.mockResolvedValue(tracado(...MV, ...LV));
    montar();
    await escolher("LPD-1");
    await waitFor(() => expect(mapa().getAttribute("data-circuito")).toBe("LPD-1"));
    await waitFor(() => expect(mapa().getAttribute("data-tracado")).toBe("3"));
  });
});

describe("circuito sem traçado: contorno aproximado", () => {
  it("REA-DOC (5 chaves não alinhadas): NÃO pede traçado, pede chaves e desenha polígono rotulado 'aproximado'", async () => {
    montar();
    await escolher("REA-DOC");
    await waitFor(() => expect(mapa().getAttribute("data-contorno")).toBe("poligono"));
    expect(h.tracado).not.toHaveBeenCalled();
    expect(h.chaves.mock.calls).toEqual([["REA-DOC"]]);
    expect(mapa().getAttribute("data-tracado")).toBe("0");
    expect(screen.getAllByText(/Contorno aproximado/).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText("Não (aproximado)")).toBeTruthy();
    expect(screen.queryByRole("checkbox")).toBeNull(); // sem traçado, sem caixa de baixa tensão
  });

  it.each([["CT2R1-MRI", "1 chave"], ["SMA-PAO", "2 chaves"], ["COL-3", "3 colineares"]])("%s (%s): só pontos, SEM polígono", async (codigo) => {
    montar();
    await escolher(codigo);
    await waitFor(() => expect(mapa().getAttribute("data-contorno")).toBe("pontos"));
    expect(screen.getAllByRole("note").length).toBeGreaterThan(0);
    expect(document.body.textContent).toMatch(/Menos de 3 chaves distintas \(ou todas alinhadas\): só os pontos, sem contorno/);
    expect(document.body.textContent).not.toMatch(/Contorno aproximado \(envoltória das chaves\)/); // nem na legenda
  });

  it("circuito com 1 chave e clientes nulos: 'desconhecido', nunca 0", async () => {
    montar();
    await escolher("CT2R1-MRI");
    const dl = (await screen.findByText("Total")).closest("dl")!;
    expect((dl.textContent!.match(/desconhecido/g) ?? []).length).toBe(3);
  });
});

describe('CET-LUM 2 (código com espaço; sem traçado e sem chaves; com transformadores)', () => {
  it("o código vai exato para a API; chaves NÃO são pedidas (a lista diz que não há); transformadores sim", async () => {
    montar();
    await escolher("CET-LUM 2", "cet lum 2");
    await waitFor(() => expect(mapa().getAttribute("data-trafos")).toBe("4"));
    expect(h.circuito.mock.calls).toEqual([["CET-LUM 2"]]);
    expect(h.transformadores.mock.calls).toEqual([["CET-LUM 2"]]);
    expect(h.chaves).not.toHaveBeenCalled();
    expect(h.tracado).not.toHaveBeenCalled();
    expect(mapa().getAttribute("data-contorno")).toBe(""); // sem chaves: nada a desenhar além dos transformadores
    expect(screen.getByText("sem chaves na base")).toBeTruthy();
    expect(screen.getByText(/Sem traçado e sem chaves na base/)).toBeTruthy();
  });

  it('transformadores: "clientes identificados", "N sem posição" e o apoio dos 24% no painel', async () => {
    montar();
    await escolher("CET-LUM 2", "cetlum2");
    await waitFor(() => expect(nb(document.body.textContent)).toContain("4 transformadores"));
    const t = nb(document.body.textContent);
    expect(t).toContain("4 transformadores · 1.515 clientes identificados");
    expect(t).toContain("3 no mapa");
    expect(t).toContain("1 transformador sem posição");
    expect(t).toMatch(/cerca de 24% dos clientes da base não têm alimentador/);
    expect(screen.getByText(/Círculo com o nº de clientes identificados/)).toBeTruthy();
  });

  it("enquadramento só quando OS, chaves e transformadores terminam de carregar (circuito sem bbox)", async () => {
    let liberar: (v: unknown) => void = () => {};
    h.transformadores.mockReturnValue(new Promise((r) => { liberar = r; }));
    montar();
    await escolher("CET-LUM 2", "cetlum2");
    await screen.findByText("Carregando os transformadores…");
    expect(mapa().getAttribute("data-limites")).toBe("nao");
    await act(async () => { liberar(TRAFOS["CET-LUM 2"]); });
    await waitFor(() => expect(mapa().getAttribute("data-limites")).toBe("sim"));
  });
});

describe("painel do circuito", () => {
  it("LPD-1: clientes, traçado real, chaves, OS do alimentador em ordem informativa", async () => {
    montar();
    await escolher("LPD-1");
    const dl = (await screen.findByText("Total")).closest("dl")!;
    expect(nb(dl.textContent)).toContain(`Total${(5683).toLocaleString("pt-BR")}`);
    expect(nb(dl.textContent)).toContain(`Ligados${(4715).toLocaleString("pt-BR")}`);
    expect(nb(dl.textContent)).toContain("Desligados968");
    expect(screen.getByText("Sim (real, por trecho)")).toBeTruthy();
    await screen.findByText("OS-LPD1", { selector: "td" });
    expect(screen.getAllByText(/Ordem informativa pela prioridade legada mapeada/).length).toBeGreaterThan(0);
  });

  it("legenda do circuito: trechos, tipos de chave pelo nome e contorno só quando aproximado", async () => {
    montar();
    await escolher("LPD-1");
    await waitFor(() => expect(screen.getByText("Trecho 3")).toBeTruthy());
    expect(screen.getByText("Trecho 1")).toBeTruthy();
    expect(screen.getByText("Chave Fusível").closest("li")!.textContent).toMatch(/2$/);
    expect(screen.getByText("Chave Faca")).toBeTruthy();
    expect(screen.queryByText(/Contorno aproximado \(envoltória das chaves\)/)).toBeNull();
  });
});

describe("clicar numa OS no mapa", () => {
  it("OS de circuito identificado abre o circuito", async () => {
    montar();
    await screen.findByTestId("mapa");
    await screen.findByRole("searchbox");
    act(() => h.mapa!.onSelecionar("OS-LPD5"));
    await waitFor(() => expect(mapa().getAttribute("data-circuito")).toBe("LPD-5"));
    expect(h.circuito.mock.calls).toEqual([["LPD-5"]]);
  });

  it("OS de circuito NÃO identificado não abre circuito sozinha; o botão explícito abre", async () => {
    montar();
    await screen.findByRole("searchbox");
    act(() => h.mapa!.onSelecionar("OS-CET")); // CET-LUM 2 existe na lista, mas a OS é 'não identificado'
    await screen.findByRole("heading", { name: "OS-CET" });
    expect(h.circuito).not.toHaveBeenCalled();
    expect(mapa().getAttribute("data-circuito")).toBe("");
    fireEvent.click(screen.getByRole("button", { name: "Abrir o alimentador informado (CET-LUM 2)" }));
    await waitFor(() => expect(mapa().getAttribute("data-circuito")).toBe("CET-LUM 2"));
    expect(h.circuito.mock.calls).toEqual([["CET-LUM 2"]]);
  });

  it("OS de alimentador não identificado que nem existe na lista (CQT1-CQT): sem botão e sem circuito", async () => {
    montar();
    await screen.findByRole("searchbox");
    act(() => h.mapa!.onSelecionar("OS-CQT"));
    await screen.findByRole("heading", { name: "OS-CQT" });
    expect(screen.queryByRole("button", { name: /Abrir o alimentador informado/ })).toBeNull();
    expect(h.circuito).not.toHaveBeenCalled();
  });
});

describe("erros e sessão", () => {
  it("erro 500 nas chaves: mensagem no painel e tentar novamente refaz só essa consulta", async () => {
    h.chaves.mockRejectedValueOnce(new ApiError(500, "Falha ao consultar a rede"));
    montar();
    await escolher("REA-DOC");
    const a = await screen.findByText(/Não foi possível carregar as chaves/);
    expect(a.closest("[role=alert]")).toBeTruthy();
    h.chaves.mockResolvedValue(CHAVES["REA-DOC"]);
    fireEvent.click(within(a.closest("[role=alert]") as HTMLElement).getByText("Tentar novamente"));
    await waitFor(() => expect(mapa().getAttribute("data-contorno")).toBe("poligono"));
    expect(h.chaves).toHaveBeenCalledTimes(2);
    expect(h.circuito).toHaveBeenCalledTimes(1);
  });

  it("401 ao carregar os transformadores: sai da sessão e volta ao login", async () => {
    h.transformadores.mockRejectedValue(new ApiError(401, "Sessão inválida"));
    montar();
    await escolher("LPD-1");
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/login"));
    expect(h.signOut).toHaveBeenCalled();
  });

  it("403 ao carregar o circuito: mensagem de acesso no painel, sem derrubar o mapa", async () => {
    h.circuito.mockRejectedValue(new ApiError(403, "Sem permissão"));
    montar();
    await escolher("LPD-1");
    expect((await screen.findAllByText(/Seu perfil não tem acesso ao Mapa da rede/)).length).toBeGreaterThan(0);
    expect(screen.getByTestId("mapa")).toBeTruthy();
    expect(h.replace).not.toHaveBeenCalled();
  });

  it("falha na lista de circuitos: aviso no seletor e o mapa de OS continua", async () => {
    h.circuitos.mockRejectedValue(new ApiError(500, "Falha"));
    montar();
    expect(await screen.findByText(/Não foi possível carregar os alimentadores/)).toBeTruthy();
    expect(screen.getByTestId("mapa").getAttribute("data-total")).toBe(String(OS.length));
  });

  it("circuito indisponível no momento da escolha (carregando): pedido não dispara antes da lista", async () => {
    h.circuitos.mockReturnValue(new Promise(() => {}));
    montar();
    await screen.findByText("Carregando a lista de alimentadores…");
    expect(h.circuito).not.toHaveBeenCalled();
  });
});
