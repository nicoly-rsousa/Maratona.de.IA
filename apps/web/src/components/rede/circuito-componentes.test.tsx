import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Contorno } from "@farol/shared";
import { ApiError } from "@/lib/api";
import type { DetalheCircuito } from "@/lib/rede-api";
import { contornoDoCircuito, coresDosTiposDeChave, nomeDoTipoDaChave } from "@/lib/rede-circuito";
import type { EstadoConsulta } from "@/lib/use-circuito-rede";
import { chave, chaves, circuitoResumo, gerarOSReais, linhaTracado, tracado, trafo } from "@/test/fixtures-rede";
import { DetalheOS } from "./detalhe-os";
import { LegendaCircuito } from "./legenda-circuito";
import { PainelCircuito } from "./painel-circuito";
import { SeletorCircuito } from "./seletor-circuito";

const nb = (s: string | null) => (s ?? "").replace(/ /g, " ");
const est = <T,>(dados?: T, extra: Partial<EstadoConsulta<T>> = {}): EstadoConsulta<T> => ({ dados, carregando: false, erro: null, refazer: () => {}, ...extra });
const detalheVazio: DetalheCircuito = { circuito: { codigo: "X", clientes: null, ligados: null, desligados: null, classes: null, chaves_qtd: null, tem_tracado: false, bbox_min_lat: null, bbox_min_lng: null, bbox_max_lat: null, bbox_max_lng: null }, ordem_informativa: true, aviso_ordem: "", os: [] };

function painel(over: Partial<React.ComponentProps<typeof PainelCircuito>> = {}) {
  const props: React.ComponentProps<typeof PainelCircuito> = {
    item: circuitoResumo("LPD-1", { tem_tracado: true, chaves_qtd: 439, clientes_total: 5683, clientes_ligados: 4715, clientes_desligados: 968, qtd_os: 117 }),
    detalhe: est(detalheVazio), chaves: est(chaves(chave(0, 0), chave(0, 1), chave(1, 0))), tracado: est(tracado(linhaTracado("MV", 1, "a"))),
    transformadores: est([trafo("T1", 100), trafo("T2", 50), trafo("T3", 30, null, null)]),
    baixaTensao: false, baixaTensaoCarregando: false, baixaTensaoErro: null, onBaixaTensao: () => {}, contorno: null,
    onLimpar: () => {}, onVerNoMapa: () => {}, selecionadaOS: null, ...over,
  };
  return render(<PainelCircuito {...props} />);
}

describe("SeletorCircuito", () => {
  const lista = [
    circuitoResumo("CET-LUM2", { qtd_os: 3, clientes_total: 10 }), circuitoResumo("CET-LUM 2", { qtd_os: 7, clientes_total: null }),
    circuitoResumo("LPD-1", { qtd_os: 117, clientes_total: 5683, tem_tracado: true }),
  ];
  const montar = (extra: Partial<React.ComponentProps<typeof SeletorCircuito>> = {}) => {
    const onSelecionar = vi.fn();
    render(<SeletorCircuito circuitos={lista} carregando={false} erro={null} selecionado={null} onSelecionar={onSelecionar} onRetry={() => {}} {...extra} />);
    return onSelecionar;
  };
  it("sem busca, lista os circuitos com mais OS primeiro e informa o total", () => {
    montar();
    const botoes = screen.getAllByRole("button");
    expect(botoes[0]!.textContent).toMatch(/^LPD-1/);
    expect(screen.getByText("Buscar entre 3 alimentadores")).toBeTruthy();
  });
  it('buscar "cetlum2" encontra as DUAS grafias; clientes nulos aparecem como "desconhecido"', () => {
    montar();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "cetlum2" } });
    const botoes = screen.getAllByRole("button");
    expect(botoes.map((b) => b.querySelector(".m")!.textContent)).toEqual(["CET-LUM 2", "CET-LUM2"]);
    expect(botoes[0]!.textContent).toMatch(/clientes: desconhecido/);
  });
  it("clicar seleciona; clicar de novo no selecionado limpa", () => {
    const sel = montar();
    fireEvent.click(screen.getByRole("button", { name: /LPD-1/ }));
    expect(sel).toHaveBeenCalledWith("LPD-1");
    document.body.innerHTML = "";
    const sel2 = montar({ selecionado: "LPD-1" });
    const b = screen.getByRole("button", { name: /LPD-1/ });
    expect(b.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(b);
    expect(sel2).toHaveBeenCalledWith(null);
  });
  it("sem resultado avisa; muitos resultados pedem para refinar", () => {
    montar();
    fireEvent.change(screen.getByRole("searchbox"), { target: { value: "zzz" } });
    expect(screen.getByText("Nenhum alimentador encontrado.")).toBeTruthy();
    document.body.innerHTML = "";
    const muitos = Array.from({ length: 50 }, (_, i) => circuitoResumo(`C-${String(i).padStart(2, "0")}`, { qtd_os: i }));
    render(<SeletorCircuito circuitos={muitos} carregando={false} erro={null} selecionado={null} onSelecionar={() => {}} onRetry={() => {}} />);
    expect(screen.getByText(/Mostrando 30 de 50: refine a busca/)).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(30);
  });
  it("carregando e erro", () => {
    render(<SeletorCircuito circuitos={undefined} carregando erro={null} selecionado={null} onSelecionar={() => {}} onRetry={() => {}} />);
    expect(screen.getByText("Carregando a lista de alimentadores…")).toBeTruthy();
    document.body.innerHTML = "";
    const retry = vi.fn();
    render(<SeletorCircuito circuitos={undefined} carregando={false} erro={new ApiError(500, "Falha")} selecionado={null} onSelecionar={() => {}} onRetry={retry} />);
    fireEvent.click(screen.getByText("Tentar novamente"));
    expect(retry).toHaveBeenCalled();
  });
});

describe("PainelCircuito", () => {
  it("clientes: total, ligados e desligados em pt-BR", () => {
    painel();
    const dl = screen.getByText("Total").closest("dl")!;
    expect(nb(dl.textContent)).toContain(`Total${(5683).toLocaleString("pt-BR")}`);
    expect(nb(dl.textContent)).toContain(`Ligados${(4715).toLocaleString("pt-BR")}`);
    expect(nb(dl.textContent)).toContain("Desligados968");
  });
  it('clientes desconhecidos (nulos) aparecem como "desconhecido", nunca 0', () => {
    painel({ item: circuitoResumo("CT2R1-MRI", { chaves_qtd: 1 }) });
    const dl = screen.getByText("Total").closest("dl")!;
    expect((dl.textContent!.match(/desconhecido/g) ?? []).length).toBe(3);
    expect(dl.textContent).not.toMatch(/\b0\b/);
  });
  it("traçado real: 'Sim' e mostra a caixa de baixa tensão DESLIGADA por padrão", () => {
    painel();
    expect(screen.getByText("Sim (real, por trecho)")).toBeTruthy();
    const cx = screen.getByRole("checkbox", { name: /baixa tensão/i }) as HTMLInputElement;
    expect(cx.checked).toBe(false);
    expect(screen.getByText(/Desligada por padrão/)).toBeTruthy();
  });
  it("marcar a caixa avisa; carregando a baixa tensão aparece só quando ligada", () => {
    const aoLigar = vi.fn();
    painel({ onBaixaTensao: aoLigar });
    fireEvent.click(screen.getByRole("checkbox", { name: /baixa tensão/i }));
    expect(aoLigar).toHaveBeenCalledWith(true);
    document.body.innerHTML = "";
    painel({ baixaTensao: true, baixaTensaoCarregando: true });
    expect(screen.getByText("Carregando a baixa tensão…")).toBeTruthy();
    document.body.innerHTML = "";
    painel({ baixaTensao: false, baixaTensaoCarregando: true });
    expect(screen.queryByText("Carregando a baixa tensão…")).toBeNull();
  });
  it("sem traçado: não há caixa de baixa tensão; diz 'aproximado'", () => {
    painel({ item: circuitoResumo("REA-DOC", { chaves_qtd: 1114, clientes_total: 7534 }) });
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText("Não (aproximado)")).toBeTruthy();
    expect(screen.getByText(/Sem traçado na base: o contorno é aproximado/)).toBeTruthy();
  });
  it("sem traçado e com polígono: nota do contorno aproximado; com menos de 3 chaves: só os pontos", () => {
    const poli: Contorno = contornoDoCircuito(false, [chave(0, 0), chave(0, 1), chave(1, 0)])!;
    painel({ item: circuitoResumo("REA-DOC", { chaves_qtd: 3 }), contorno: poli });
    expect(screen.getByRole("note").textContent).toMatch(/Contorno aproximado.*Não é o traçado real/);
    document.body.innerHTML = "";
    painel({ item: circuitoResumo("SMA-PAO", { chaves_qtd: 2 }), chaves: est(chaves(chave(0, 0), chave(1, 1))), contorno: { tipo: "pontos", pontos: [] } });
    expect(screen.getByRole("note").textContent).toMatch(/Menos de 3 chaves distintas.*só os pontos, sem contorno/);
  });
  it('sem chaves na base: "sem chaves na base" (não é 0)', () => {
    painel({ item: circuitoResumo("CET-LUM 2", { chaves_qtd: null }), chaves: est<never>(undefined) });
    expect(screen.getByText("sem chaves na base")).toBeTruthy();
    expect(screen.getByText(/Sem traçado e sem chaves na base/)).toBeTruthy();
  });
  it('transformadores: contagem, "clientes identificados", "N sem posição" e o texto de apoio dos 24%', () => {
    painel();
    const t = nb(document.body.textContent);
    expect(t).toContain("3 transformadores · 180 clientes identificados");
    expect(t).toContain("2 no mapa (círculo com o nº de clientes identificados) · 1 transformador sem posição");
    expect(t).toMatch(/cerca de 24% dos clientes da base não têm alimentador/);
  });
  it("plural de 'sem posição' e circuito sem transformadores", () => {
    painel({ transformadores: est([trafo("A", 1, null, null), trafo("B", 2, null, null)]) });
    expect(nb(document.body.textContent)).toContain("2 transformadores sem posição");
    document.body.innerHTML = "";
    painel({ transformadores: est([]) });
    expect(screen.getByText("Nenhum transformador na base para este alimentador.")).toBeTruthy();
  });
  it("OS do alimentador: aviso de ordem informativa, linhas e 'Ver no mapa'", () => {
    const os = gerarOSReais().slice(1, 4).map((o) => ({ ...o, clientes: null, familia_ativo: null, origem_geo: null }));
    const ver = vi.fn();
    painel({ detalhe: est({ ...detalheVazio, os }), onVerNoMapa: ver, selecionadaOS: os[1]!.numero });
    expect(screen.getByText(/Ordem informativa pela prioridade legada mapeada; não é a fila/)).toBeTruthy();
    expect(screen.getAllByRole("row")).toHaveLength(4);
    fireEvent.click(screen.getByRole("button", { name: `Ver a OS ${os[2]!.numero} no mapa` }));
    expect(ver).toHaveBeenCalledWith(os[2]!.numero);
  });
  it("estados: carregando e erro de cada parte, com tentar novamente", () => {
    const refazer = vi.fn();
    painel({ item: circuitoResumo("A", { chaves_qtd: 4 }), chaves: est<never>(undefined, { carregando: true }), transformadores: est<never>(undefined, { carregando: true }), detalhe: est<never>(undefined, { carregando: true }) });
    expect(screen.getByText("Carregando as chaves…")).toBeTruthy();
    expect(screen.getByText("Carregando os transformadores…")).toBeTruthy();
    expect(screen.getByText("Carregando as OS do alimentador…")).toBeTruthy();
    document.body.innerHTML = "";
    painel({ chaves: est<never>(undefined, { erro: new ApiError(500, "falhou"), refazer }) });
    const a = screen.getByRole("alert");
    expect(a.textContent).toMatch(/Não foi possível carregar as chaves/);
    fireEvent.click(within(a).getByText("Tentar novamente"));
    expect(refazer).toHaveBeenCalled();
  });
  it("'Limpar seleção' chama o callback", () => {
    const limpar = vi.fn();
    painel({ onLimpar: limpar });
    fireEvent.click(screen.getByText("Limpar seleção"));
    expect(limpar).toHaveBeenCalled();
  });
});

describe("LegendaCircuito", () => {
  const ch = [chave(0, 0, "FU - Chave Fusível"), chave(0, 1, "FU - Chave Fusível"), chave(1, 0, "CF - Chave Faca"), chave(1, 1, null)];
  const cores = coresDosTiposDeChave(ch.map(nomeDoTipoDaChave));
  const trac = [linhaTracado("MV", 1, "a"), linhaTracado("MV", 2, "b"), linhaTracado("LV", 3, "c"), linhaTracado("MV", 3, "d")];
  it("traçado por trecho com a contagem, e os segmentos de baixa tensão apontados", () => {
    render(<LegendaCircuito tracado={trac} chaves={ch} coresChaves={cores} contorno={null} qtdTransformadoresNoMapa={0} />);
    expect(screen.getByText("Trecho 1")).toBeTruthy();
    expect(screen.getByText("Trecho 2")).toBeTruthy();
    expect(screen.getByText("Trecho 3").closest("li")!.textContent).toMatch(/2 segmentos \(1 de baixa tensão\)/);
  });
  it("chaves pelo NOME do tipo (e 'Tipo não informado'), com a contagem", () => {
    render(<LegendaCircuito tracado={[]} chaves={ch} coresChaves={cores} contorno={null} qtdTransformadoresNoMapa={0} />);
    expect(screen.getByText("Chave Fusível").closest("li")!.textContent).toMatch(/2$/);
    expect(screen.getByText("Chave Faca")).toBeTruthy();
    expect(screen.getByText("Tipo não informado")).toBeTruthy();
    expect(screen.queryByText("Trecho 1")).toBeNull();
  });
  it("transformador só aparece quando há algum no mapa", () => {
    const { rerender } = render(<LegendaCircuito tracado={[]} chaves={[]} coresChaves={{}} contorno={null} qtdTransformadoresNoMapa={0} />);
    expect(screen.queryByText(/Círculo com o nº de clientes identificados/)).toBeNull();
    rerender(<LegendaCircuito tracado={[]} chaves={[]} coresChaves={{}} contorno={null} qtdTransformadoresNoMapa={5} />);
    expect(screen.getByText(/Círculo com o nº de clientes identificados/)).toBeTruthy();
  });
  it("o contorno é rotulado 'aproximado' só quando é polígono", () => {
    const poli = contornoDoCircuito(false, [chave(0, 0), chave(0, 1), chave(1, 0)]);
    const { rerender } = render(<LegendaCircuito tracado={[]} chaves={ch} coresChaves={cores} contorno={poli} qtdTransformadoresNoMapa={0} />);
    expect(screen.getByText(/Contorno aproximado \(envoltória das chaves\)/)).toBeTruthy();
    rerender(<LegendaCircuito tracado={[]} chaves={ch} coresChaves={cores} contorno={{ tipo: "pontos", pontos: [] }} qtdTransformadoresNoMapa={0} />);
    expect(screen.queryByText(/Contorno aproximado/)).toBeNull();
  });
});

describe("DetalheOS: abrir o circuito informado é ação explícita", () => {
  const sem = gerarOSReais().find((o) => o.circuito_origem === "nao_identificado")!;
  it("OS de alimentador não identificado com código existente oferece o botão", () => {
    const abrir = vi.fn();
    render(<DetalheOS os={{ ...sem, circuito: "CET-LUM 2" }} circuitoAbrivel="CET-LUM 2" onAbrirCircuito={abrir} />);
    fireEvent.click(screen.getByRole("button", { name: "Abrir o alimentador informado (CET-LUM 2)" }));
    expect(abrir).toHaveBeenCalledWith("CET-LUM 2");
  });
  it("sem código existente, ou OS identificada, não há botão", () => {
    render(<DetalheOS os={sem} circuitoAbrivel={null} onAbrirCircuito={() => {}} />);
    expect(screen.queryByRole("button")).toBeNull();
    document.body.innerHTML = "";
    const ok = gerarOSReais()[1]!;
    render(<DetalheOS os={ok} circuitoAbrivel="C-1" onAbrirCircuito={() => {}} />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
