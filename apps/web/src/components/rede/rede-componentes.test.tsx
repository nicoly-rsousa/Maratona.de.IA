import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { Legenda } from "./legenda";
import { ListaSemCircuito } from "./lista-sem-circuito";
import { DetalheOS } from "./detalhe-os";
import { ErroRede } from "./estados";
import { ApiError } from "@/lib/api";
import { gerarOSReais, CONTAGEM_REAL, SEM_CIRCUITO_REAL, TOTAL_REAL } from "@/test/fixtures-rede";

const nb = (s: string | null) => (s ?? "").replace(/ /g, " ");
const linhaDaLegenda = (rotulo: string) => screen.getByText(rotulo).closest("li") as HTMLElement;

describe("Legenda", () => {
  const os = gerarOSReais();
  it("é informativa e diz que não é a fila do Farol", () => {
    render(<Legenda os={os} />);
    expect(screen.getByRole("heading", { name: /informativa, não é a fila do Farol/i })).toBeTruthy();
  });
  it("mostra as 5 classes com a contagem real (soma 4.513) e 'Sem mapa' com zero", () => {
    expect(TOTAL_REAL).toBe(4513);
    render(<Legenda os={os} />);
    const esperado: [string, number][] = [["Emergente", CONTAGEM_REAL.c0], ["Urgente", CONTAGEM_REAL.c1], ["Alta", CONTAGEM_REAL.c2], ["Média", CONTAGEM_REAL.c3], ["Baixa", CONTAGEM_REAL.c4], ["Sem mapa", 0]];
    let soma = 0;
    for (const [rotulo, qtd] of esperado) {
      expect(nb(linhaDaLegenda(rotulo).textContent)).toContain(`${qtd.toLocaleString("pt-BR")} OS`);
      soma += qtd;
    }
    expect(soma).toBe(TOTAL_REAL);
  });
  it("conta 'sem mapa' à parte, sem somar na classe 0", () => {
    const so = gerarOSReais().slice(0, 10).map((o, i) => (i < 3 ? { ...o, prioridade_codigo: null } : o));
    render(<Legenda os={so} />);
    expect(nb(linhaDaLegenda("Sem mapa").textContent)).toContain("3 OS");
    expect(nb(linhaDaLegenda("Emergente").textContent)).toContain("7 OS");
  });
  it("a linha do anel vazado traz as 40 OS sem circuito", () => {
    render(<Legenda os={os} />);
    expect(nb(linhaDaLegenda("Anel vazado: alimentador não identificado").textContent)).toContain(`${SEM_CIRCUITO_REAL} OS`);
  });
  it("explica o contorno tracejado de 'sem mapa'", () => {
    render(<Legenda os={os} />);
    expect(screen.getByText(/Contorno tracejado = sem mapa/)).toBeTruthy();
  });
});

describe("ListaSemCircuito: as 40 OS", () => {
  const todas = gerarOSReais();
  const sem = todas.filter((o) => o.circuito_origem === "nao_identificado");
  it("a fixture tem exatamente 40 OS sem alimentador identificado", () => expect(sem).toHaveLength(SEM_CIRCUITO_REAL));
  it("lista as 40 com o aviso combinado e o título com a contagem", () => {
    render(<ListaSemCircuito os={sem} selecionada={null} onVerNoMapa={() => {}} />);
    expect(screen.getByRole("heading", { name: "OS sem alimentador identificado (40)" })).toBeTruthy();
    expect(screen.getByRole("note").textContent).toMatch(/Não é corrigido automaticamente/);
    const corpo = screen.getAllByRole("row").slice(1);
    expect(corpo).toHaveLength(40);
    expect(screen.getAllByRole("button", { name: /Ver a OS .* no mapa/ })).toHaveLength(40);
  });
  it("mostra o circuito informado e '(vazio)' quando não veio nada; nenhuma OS é descartada", () => {
    const comVazio = [{ ...sem[0]!, circuito: null }, sem[1]!];
    render(<ListaSemCircuito os={comVazio} selecionada={null} onVerNoMapa={() => {}} />);
    expect(screen.getByText("(vazio)")).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(3);
  });
  it("'Ver no mapa' chama a seleção com o número da OS", () => {
    const aoVer = vi.fn();
    render(<ListaSemCircuito os={sem} selecionada={null} onVerNoMapa={aoVer} />);
    fireEvent.click(screen.getByRole("button", { name: `Ver a OS ${sem[3]!.numero} no mapa` }));
    expect(aoVer).toHaveBeenCalledWith(sem[3]!.numero);
  });
  it("lista vazia: mensagem em vez de tabela", () => {
    render(<ListaSemCircuito os={[]} selecionada={null} onVerNoMapa={() => {}} />);
    expect(screen.getByText(/Nenhuma OS com alimentador não identificado/)).toBeTruthy();
    expect(screen.queryByRole("table")).toBeNull();
  });
});

describe("DetalheOS", () => {
  const os = gerarOSReais();
  it("sem seleção, orienta a clicar", () => {
    render(<DetalheOS os={null} />);
    expect(screen.getByText(/Clique numa OS no mapa/)).toBeTruthy();
  });
  it("classe informativa e dados da OS; sem aviso quando o circuito é conhecido", () => {
    render(<DetalheOS os={os[1]!} />);
    expect(screen.getByText("Classe (informativa)")).toBeTruthy();
    expect(screen.queryByRole("note")).toBeNull();
  });
  it("OS sem alimentador identificado mostra o aviso", () => {
    render(<DetalheOS os={os[0]!} />);
    expect(within(screen.getByRole("note")).getByText(/Alimentador não identificado/)).toBeTruthy();
  });
  it("sem mapa deixa explícito que a prioridade legada não está no mapa", () => {
    render(<DetalheOS os={{ ...os[1]!, prioridade_codigo: null }} />);
    expect(screen.getByText(/a prioridade legada não está no mapa/)).toBeTruthy();
  });
});

describe("ErroRede", () => {
  it("403: mensagem clara de falta de acesso, sem 'tentar novamente'", () => {
    render(<ErroRede erro={new ApiError(403, "Sem permissão")} titulo="Falhou." onRetry={() => {}} />);
    const a = screen.getByRole("alert");
    expect(a.textContent).toMatch(/Sem acesso\./);
    expect(a.textContent).toMatch(/não tem acesso ao Mapa da rede/);
    expect(a.textContent).toMatch(/administração/);
    expect(screen.queryByText("Tentar novamente")).toBeNull();
  });
  it("falha de servidor: título, mensagem e botão de tentar novamente funcionando", () => {
    const retry = vi.fn();
    render(<ErroRede erro={new ApiError(500, "Falha ao consultar")} titulo="Não foi possível carregar." onRetry={retry} />);
    expect(screen.getByRole("alert").textContent).toMatch(/Não foi possível carregar\./);
    fireEvent.click(screen.getByText("Tentar novamente"));
    expect(retry).toHaveBeenCalledTimes(1);
  });
});
