// Fumaça da página /rede com o mapa MOCKADO (o Leaflet não roda no jsdom), a API mockada e o Supabase mockado.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "@/lib/api";
import type { RedeConfig } from "@/lib/rede-api";
import { SEM_CIRCUITO_REAL, TOTAL_REAL, gerarOSReais, respostaOS } from "@/test/fixtures-rede";

const h = vi.hoisted(() => ({ config: vi.fn(), os: vi.fn(), replace: vi.fn(), signOut: vi.fn(async () => ({})) }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: h.replace }) }));
vi.mock("@/lib/supabase", () => ({ supabase: () => ({ auth: { signOut: h.signOut } }) }));
vi.mock("@/lib/rede-api", async (orig) => ({ ...(await orig<typeof import("@/lib/rede-api")>()), redeApi: { config: h.config, os: h.os } }));
vi.mock("@/components/rede/mapa-rede", () => ({
  MapaRede: (p: { os: { circuito_origem: string | null }[]; selecionada: string | null; foco: { numero: string } | null; rotulo: string }) => (
    <div
      data-testid="mapa" role="region" aria-label={p.rotulo} data-total={p.os.length}
      data-aneis={p.os.filter((o) => o.circuito_origem === "nao_identificado").length}
      data-selecionada={p.selecionada ?? ""} data-foco={p.foco?.numero ?? ""}
    />
  ),
}));

const { default: RedePage } = await import("./page");

const CFG: RedeConfig = { raioPadraoM: 1000, raioMaxM: 5000, pode_sugerir: true };
const nb = (s: string | null) => (s ?? "").replace(/ /g, " ");

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  return render(<QueryClientProvider client={qc}><RedePage /></QueryClientProvider>);
}

beforeEach(() => {
  h.config.mockReset(); h.os.mockReset(); h.replace.mockReset(); h.signOut.mockClear();
  h.config.mockResolvedValue(CFG);
});

describe("porta de entrada (/rede/config)", () => {
  it("carregando: mostra 'Verificando seu acesso' e ainda não pede as OS", () => {
    h.config.mockReturnValue(new Promise(() => {}));
    montar();
    expect(screen.getByText("Verificando seu acesso ao Mapa da rede…")).toBeTruthy();
    expect(h.os).not.toHaveBeenCalled();
  });

  it("403 (ex.: Equipe de campo): mensagem clara, NENHUMA OS pedida e nenhum mapa", async () => {
    h.config.mockRejectedValue(new ApiError(403, "Sem permissão"));
    montar();
    const a = await screen.findByRole("alert");
    expect(a.textContent).toMatch(/Sem acesso\./);
    expect(a.textContent).toMatch(/Seu perfil não tem acesso ao Mapa da rede/);
    expect(a.textContent).toMatch(/definido pela administração/);
    expect(screen.queryByText("Tentar novamente")).toBeNull();
    expect(screen.queryByTestId("mapa")).toBeNull();
    expect(h.os).not.toHaveBeenCalled();
    expect(h.signOut).not.toHaveBeenCalled();
    expect(h.replace).not.toHaveBeenCalled();
  });

  it("401 na config: sai da sessão e volta ao login", async () => {
    h.config.mockRejectedValue(new ApiError(401, "Sessão inválida"));
    montar();
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/login"));
    expect(h.signOut).toHaveBeenCalledTimes(1);
    expect(h.os).not.toHaveBeenCalled();
    expect(screen.queryByTestId("mapa")).toBeNull();
  });

  it("erro de servidor na config: oferece tentar novamente (e nova tentativa funciona)", async () => {
    h.config.mockRejectedValueOnce(new ApiError(500, "Falha"));
    h.os.mockResolvedValue(respostaOS(gerarOSReais()));
    montar();
    fireEvent.click(await screen.findByText("Tentar novamente"));
    expect(await screen.findByTestId("mapa")).toBeTruthy();
    expect(h.config).toHaveBeenCalledTimes(2);
  });
});

describe("OS (/rede/os)", () => {
  it("carregando as OS", async () => {
    h.os.mockReturnValue(new Promise(() => {}));
    montar();
    expect(await screen.findByText("Carregando as OS…")).toBeTruthy();
  });

  it("401 ao carregar as OS: volta ao login", async () => {
    h.os.mockRejectedValue(new ApiError(401, "Sessão inválida"));
    montar();
    await waitFor(() => expect(h.replace).toHaveBeenCalledWith("/login"));
    expect(h.signOut).toHaveBeenCalled();
  });

  it("403 ao carregar as OS: mensagem de acesso, sem mapa", async () => {
    h.os.mockRejectedValue(new ApiError(403, "Sem permissão"));
    montar();
    expect((await screen.findByRole("alert")).textContent).toMatch(/não tem acesso ao Mapa da rede/);
    expect(screen.queryByTestId("mapa")).toBeNull();
  });

  it("erro 500: mensagem, tentar novamente refaz a consulta e mostra os dados", async () => {
    h.os.mockRejectedValueOnce(new ApiError(500, "Falha ao consultar as OS")).mockResolvedValue(respostaOS(gerarOSReais()));
    montar();
    const a = await screen.findByRole("alert");
    expect(a.textContent).toMatch(/Não foi possível carregar as OS\./);
    fireEvent.click(within(a).getByText("Tentar novamente"));
    expect(await screen.findByTestId("mapa")).toBeTruthy();
    expect(h.os).toHaveBeenCalledTimes(2);
  });

  it("vazio: nenhuma OS importada, com botão de recarregar e sem mapa", async () => {
    h.os.mockResolvedValue(respostaOS([]));
    montar();
    expect(await screen.findByText(/Nenhuma OS importada/)).toBeTruthy();
    expect(screen.queryByTestId("mapa")).toBeNull();
    expect(screen.getByText("Recarregar dados")).toBeTruthy();
  });
});

describe("visão geral com as 4.513 OS", () => {
  beforeEach(() => h.os.mockResolvedValue(respostaOS(gerarOSReais())));

  it("entrega as 4.513 OS ao mapa, com as 40 de circuito não identificado marcadas para anel vazado", async () => {
    montar();
    const mapa = await screen.findByTestId("mapa");
    expect(mapa.getAttribute("data-total")).toBe(String(TOTAL_REAL));
    expect(mapa.getAttribute("data-aneis")).toBe(String(SEM_CIRCUITO_REAL));
    expect(h.os).toHaveBeenCalledTimes(1);
  });

  it("cabeçalho: total, data da importação e aviso de que é informativa (não é a fila do Farol)", async () => {
    montar();
    await screen.findByTestId("mapa");
    expect(nb(document.body.textContent)).toContain(`${TOTAL_REAL.toLocaleString("pt-BR")} OS`.replace(/ /g, " "));
    expect(document.body.textContent).toMatch(/dados importados em \d{2}\/\d{2}\/\d{4} às \d{2}:\d{2}/);
    expect(document.body.textContent).toMatch(/guardado por 5 min/);
    expect(document.body.textContent).toMatch(/não é a fila de prioridade do Farol/);
    expect(screen.getByRole("heading", { name: /informativa, não é a fila do Farol/i })).toBeTruthy();
  });

  it("legenda com a contagem e lista com as 40 OS e o aviso combinado", async () => {
    montar();
    await screen.findByTestId("mapa");
    const tit = screen.getByRole("heading", { name: "OS sem circuito identificado (40)" });
    expect(tit).toBeTruthy();
    expect(screen.getAllByRole("note").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("button", { name: /Ver a OS .* no mapa/ })).toHaveLength(SEM_CIRCUITO_REAL);
    expect(document.body.textContent).toMatch(/Não é corrigido automaticamente/);
    expect(nb(screen.getByText("Anel vazado: circuito não identificado").closest("li")!.textContent)).toContain("40 OS");
  });

  it("'Ver no mapa' seleciona a OS, pede o foco e mostra o detalhe com o aviso", async () => {
    montar();
    await screen.findByTestId("mapa");
    const sem = gerarOSReais().filter((o) => o.circuito_origem === "nao_identificado");
    fireEvent.click(screen.getByRole("button", { name: `Ver a OS ${sem[2]!.numero} no mapa` }));
    const mapa = screen.getByTestId("mapa");
    expect(mapa.getAttribute("data-selecionada")).toBe(sem[2]!.numero);
    expect(mapa.getAttribute("data-foco")).toBe(sem[2]!.numero);
    expect(screen.getByRole("heading", { name: sem[2]!.numero })).toBeTruthy();
  });

  it("'Recarregar dados' busca de novo e fica desabilitado durante a busca", async () => {
    montar();
    await screen.findByTestId("mapa");
    let liberar: (v: ReturnType<typeof respostaOS>) => void = () => {};
    h.os.mockReturnValue(new Promise((r) => { liberar = r; }));
    fireEvent.click(screen.getByText("Recarregar dados"));
    await waitFor(() => expect((screen.getByText("Atualizando…") as HTMLButtonElement).disabled).toBe(true));
    liberar(respostaOS(gerarOSReais()));
    await waitFor(() => expect(screen.getByText("Recarregar dados")).toBeTruthy());
    expect(h.os).toHaveBeenCalledTimes(2);
  });

  it("OS sem coordenada: avisa e mantém as contagens", async () => {
    const os = gerarOSReais().map((o, i) => (i < 5 ? { ...o, lat: null, lng: null } : o));
    h.os.mockResolvedValue(respostaOS(os));
    montar();
    await screen.findByTestId("mapa");
    expect(document.body.textContent).toMatch(/5 OS sem coordenada válida não aparecem no mapa/);
    expect(screen.getByTestId("mapa").getAttribute("data-total")).toBe(String(TOTAL_REAL));
  });

  it("o mapa tem região rotulada e o atalho 'Pular o mapa' aponta para a lista", async () => {
    montar();
    expect(await screen.findByRole("region", { name: "Mapa da rede: OS importadas" })).toBeTruthy();
    expect(screen.getByText("Pular o mapa").getAttribute("href")).toBe("#lista-sem-circuito");
  });
});
