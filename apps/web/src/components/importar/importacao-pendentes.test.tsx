import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { ApiError } from "@/lib/api";
import type { ConfirmacaoLote, PreviaOSPendente } from "@/lib/importar-pendentes";

const h = vi.hoisted(() => ({ apiPost: vi.fn() }));
vi.mock("@/lib/api", async (orig) => ({ ...(await orig<typeof import("@/lib/api")>()), apiPost: h.apiPost }));
const { ImportacaoPendentes } = await import("./importacao-pendentes");

const CAB = "OSNumero;Localidade;Complemento de Localização;INSPETOR;Observação";
const arquivo = (linhas: string[], nome = "os.csv") => new File([`${CAB}\n${linhas.join("\n")}\n`], nome, { type: "text/csv" });
const nb = (s: string | null) => (s ?? "").replace(/ /g, " ");

const previa = (o: Partial<PreviaOSPendente> = {}): PreviaOSPendente => {
  const entramLinhas = o.entramLinhas ?? [2, 3, 4];
  return {
    totalLinhas: entramLinhas.length, entram: entramLinhas.length, entramLinhas, rejeitadas: [], totalRejeitadas: 0, comAviso: 0, avisosPorCodigo: {}, avisos: [],
    semCoordenada: 0, origemEndereco: { informado: 0, derivado_poste: entramLinhas.length, nao_informado: 0 }, vazios: { Logradouro: entramLinhas.length, Bairro: entramLinhas.length },
    colunasReconhecidas: {}, colunasAusentes: [], amostra: [], cidades: { municipios: 1, novas: 1, existentes: 0, exemplosNovas: [{ municipio: "MURIAE", codigo: "MURIA" }] },
    jaExistentes: 0, tamanhoLote: 200, ...o,
  };
};
const lote = (o: Partial<ConfirmacaoLote> = {}): ConfirmacaoLote => ({ recebidas: 200, criadas: 200, jaExistentes: 0, cidadesCriadas: 0, comAviso: 0, rejeitadas: [], prioridadePorCodigo: { "1": 200 }, ...o });

function montar() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ImportacaoPendentes /></QueryClientProvider>);
}
async function escolher(f: File) {
  fireEvent.change(screen.getByLabelText(/Arquivo \.csv/), { target: { files: [f] } });
}
/** O botão só habilita depois que o arquivo termina de ser lido (FileReader é assíncrono). */
async function previsualizar() {
  const b = (await screen.findByRole("button", { name: "Pré-visualizar" })) as HTMLButtonElement;
  await waitFor(() => expect(b.disabled).toBe(false));
  fireEvent.click(b);
}
const chamadas = (rota: string) => h.apiPost.mock.calls.filter((c) => c[0] === rota);

beforeEach(() => {
  h.apiPost.mockReset();
  URL.createObjectURL = vi.fn(() => "blob:teste");
  URL.revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
});

describe("arquivo: leitura no navegador e privacidade", () => {
  it("mostra o nome, as linhas e quantas colunas NÃO saem do computador", async () => {
    montar();
    await escolher(arquivo(["OS-1;MURIAE 1-1;48-160;FULANO;obs", "OS-2;MURIAE 2-2;;BELTRANO;"]));
    expect(await screen.findByText(/os\.csv/)).toBeTruthy();
    expect(document.body.textContent).toMatch(/2 linhas de dados/);
    expect(nb(document.body.textContent)).toMatch(/As outras 2 colunas do arquivo não saem do seu computador/);
  });
  it("a prévia envia SÓ as colunas reconhecidas: nenhum valor de INSPETOR/Observação vai para a API", async () => {
    h.apiPost.mockResolvedValue(previa());
    montar();
    await escolher(arquivo(["OS-1;MURIAE 1-1;48-160;FULANO DA SILVA;telefone 99999", "OS-2;MURIAE 2-2;;BELTRANO;"]));
    await previsualizar();
    await waitFor(() => expect(h.apiPost).toHaveBeenCalled());
    const [rota, corpo] = h.apiPost.mock.calls[0]!;
    expect(rota).toBe("/os/importar-pendentes/preview");
    expect((corpo as { tabela: { cabecalho: string[] } }).tabela.cabecalho).toEqual(["OSNumero", "Localidade", "Complemento de Localização"]);
    expect(JSON.stringify(corpo)).not.toMatch(/FULANO|BELTRANO|telefone|INSPETOR|Observação/);
  });
  it("arquivo sem OSNumero: erro claro e nenhuma chamada à API", async () => {
    montar();
    await escolher(new File(["Localidade;CodSetor\nMURIAE 1-1;x\n"], "errado.csv"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/OSNumero/);
    expect(screen.getByRole("button", { name: "Pré-visualizar" })).toHaveProperty("disabled", true);
    expect(h.apiPost).not.toHaveBeenCalled();
  });
  it("arquivo vazio: erro claro", async () => {
    montar();
    await escolher(new File([""], "vazio.csv"));
    expect((await screen.findByRole("alert")).textContent).toMatch(/não tem linhas de dados/);
  });
  it("Pré-visualizar fica desabilitado sem arquivo", () => {
    montar();
    expect(screen.getByRole("button", { name: "Pré-visualizar" })).toHaveProperty("disabled", true);
  });
});

describe("prévia", () => {
  async function comPrevia(p: PreviaOSPendente) {
    h.apiPost.mockResolvedValue(p);
    montar();
    await escolher(arquivo(["OS-1;MURIAE 1-1;48-160;x;y", "OS-2;MURIAE 2-2;;x;y", "OS-3;MURIAE 3-3;;x;y"]));
    await previsualizar();
    await screen.findByRole("heading", { name: "Prévia" });
  }
  it("mostra o que entra, rejeitadas, avisos, sem coordenada, já existentes e cidades novas", async () => {
    await comPrevia(previa({
      totalLinhas: 5, entram: 3, entramLinhas: [2, 3, 4], totalRejeitadas: 2, comAviso: 1, semCoordenada: 1, jaExistentes: 1,
      rejeitadas: [{ linha: 5, motivo: "sem número da OS", campos: {} }, { linha: 6, motivo: "sem município (Localidade vazia ou só com o código final)", campos: {} }],
      avisosPorCodigo: { clientes_invalido: 1 }, avisos: [{ linha: 3, campo: "Quantidade clientes", codigo: "clientes_invalido", mensagem: 'Quantidade clientes: "muitos" não é uma quantidade válida; campo deixado vazio.' }],
      cidades: { municipios: 2, novas: 2, existentes: 0, exemplosNovas: [] }, origemEndereco: { informado: 0, derivado_poste: 1, nao_informado: 2 },
    }));
    const t = nb(document.body.textContent);
    expect(t).toMatch(/Linhas lidas5/);
    expect(t).toMatch(/Entram3/);
    expect(t).toMatch(/Rejeitadas2/);
    expect(t).toMatch(/Sem coordenada1 \(entram "Em triagem"/);
    expect(t).toMatch(/Já existentes1 \(não serão duplicadas/);
    expect(t).toMatch(/2 município\(s\): 0 já são cidades, 2 serão criadas/);
    expect(t).toMatch(/Derivado do poste \(Complemento de Localização\): 1/);
    expect(t).toMatch(/Quantidade de clientes inválida: ficou vazia: 1/);
    expect(screen.getByText("Importar 3 OS em lotes de 200")).toBeTruthy();
  });
  it("campos vazios por coluna, em ordem decrescente, com percentual", async () => {
    await comPrevia(previa({ totalLinhas: 4513, vazios: { Logradouro: 4513, Bairro: 4513, DataDeadline: 0, CodSetor: 100 } }));
    const linhas = within(screen.getByRole("table", { name: /colunas com a coluna vazia|Quantidade de linhas/i })).getAllByRole("row").slice(1).map((r) => nb(r.textContent));
    expect(linhas[0]).toMatch(/^(Logradouro|Bairro)4\.513100%$/);
    expect(linhas.some((l) => l.startsWith("DataDeadline"))).toBe(false); // sem vazio, não aparece
    expect(linhas.at(-1)).toMatch(/^CodSetor100/);
  });
  it("rejeitadas: lista com linha e motivo, e o botão baixa o arquivo (CSV com BOM, sem dado pessoal)", async () => {
    await comPrevia(previa({ totalLinhas: 4, entram: 3, totalRejeitadas: 1, rejeitadas: [{ linha: 5, motivo: "sem número da OS", campos: { setor: "LPD-1" } }] }));
    expect(screen.getByText("sem número da OS")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Baixar arquivo de rejeitadas/ }));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = (URL.createObjectURL as unknown as { mock: { calls: Blob[][] } }).mock.calls[0]![0]!;
    const bytes = await new Promise<Uint8Array>((res) => { const r = new FileReader(); r.onload = () => res(new Uint8Array(r.result as ArrayBuffer)); r.readAsArrayBuffer(blob); });
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]); // BOM UTF-8 (o Excel abre com o acento certo)
    const texto = new TextDecoder().decode(bytes);
    expect(texto).toContain("5;sem número da OS");
    expect(texto).not.toMatch(/Logradouro|Bairro|Complemento/);
  });
  it("aviso sobre a prioridade: critérios sem resposta valem 'Desconhecido' e prazo/prioridade legada são só informação", async () => {
    await comPrevia(previa());
    expect(nb(document.body.textContent)).toMatch(/Desconhecido.*nunca zero/);
    expect(document.body.textContent).toMatch(/só como informação/);
  });
  it("0 linhas aceitas: o botão de importar fica desabilitado", async () => {
    await comPrevia(previa({ entram: 0, entramLinhas: [], totalRejeitadas: 3, rejeitadas: [] }));
    expect(screen.getByRole("button", { name: /Importar 0 OS/ })).toHaveProperty("disabled", true);
  });
  it("Administrador-only: 403 na prévia mostra mensagem clara", async () => {
    h.apiPost.mockRejectedValue(new ApiError(403, "Sem permissão"));
    montar();
    await escolher(arquivo(["OS-1;MURIAE 1-1;;x;y"]));
    await previsualizar();
    expect((await screen.findByRole("alert")).textContent).toMatch(/é do Administrador/);
  });
  it("erro de servidor na prévia: mostra o código e a mensagem", async () => {
    h.apiPost.mockRejectedValue(new ApiError(500, "Configuração da importação indisponível."));
    montar();
    await escolher(arquivo(["OS-1;MURIAE 1-1;;x;y"]));
    await previsualizar();
    expect((await screen.findByRole("alert")).textContent).toBe("500 — Configuração da importação indisponível.");
  });
});

describe("importação em lotes", () => {
  const linhas = (n: number) => Array.from({ length: n }, (_, i) => `OS-${i};MURIAE ${i}-1;;x;y`);
  async function iniciar(total: number, p: Partial<PreviaOSPendente> = {}, confirmar: (n: number) => Promise<ConfirmacaoLote> | ConfirmacaoLote = () => lote()) {
    const aceitas = Array.from({ length: total }, (_, i) => i + 2).filter((l) => l !== 7); // a linha 7 foi rejeitada na prévia
    let k = 0;
    h.apiPost.mockImplementation(async (rota: string) => (rota.endsWith("/preview") ? previa({ entramLinhas: aceitas, entram: aceitas.length, totalLinhas: total, ...p }) : confirmar(k++)));
    montar();
    await escolher(arquivo(linhas(total)));
    await previsualizar();
    await screen.findByRole("heading", { name: "Prévia" });
    return aceitas;
  }

  it("450 linhas (1 rejeitada): 3 lotes de 200, 200 e 49, só com as linhas aceitas; progresso e resumo final", async () => {
    const aceitas = await iniciar(450, {}, (k) => lote({ recebidas: [200, 200, 49][k]!, criadas: [200, 200, 49][k]!, cidadesCriadas: k === 0 ? 1 : 0, prioridadePorCodigo: { "1": [200, 200, 49][k]! } }));
    fireEvent.click(screen.getByRole("button", { name: /Importar 449 OS em lotes de 200/ }));
    await screen.findByText(/Importação concluída/);
    const cs = chamadas("/os/importar-pendentes/confirmar");
    expect(cs).toHaveLength(3);
    const linhasDe = (i: number) => (cs[i]![1] as { tabela: { linhas: { linha: number }[] } }).tabela.linhas.map((l) => l.linha);
    expect([linhasDe(0).length, linhasDe(1).length, linhasDe(2).length]).toEqual([200, 200, 49]);
    expect([...linhasDe(0), ...linhasDe(1), ...linhasDe(2)]).toEqual(aceitas);
    expect(linhasDe(0)).not.toContain(7); // a rejeitada não é reenviada
    expect(nb(document.body.textContent)).toMatch(/449 OS criadas, 0 já existentes.*1 cidade\(s\) criada\(s\)/);
    expect(screen.getByText("Importar 449 OS em lotes de 200")).toHaveProperty("disabled", true);
    expect(screen.getByText("Urgente").closest("li")!.textContent).toMatch(/Prioridade Urgente: 449 OS/);
  });

  it("falha no 2º lote: para, mostra o erro e 'Retomar' continua do lote que falhou (sem reenviar o 1º)", async () => {
    let falhou = false;
    await iniciar(450, {}, (k) => {
      if (k === 1 && !falhou) { falhou = true; throw new ApiError(500, "Falha ao gravar o lote. Nada deste lote foi gravado; pode reenviá-lo."); }
      return lote({ criadas: 200 });
    });
    fireEvent.click(screen.getByRole("button", { name: /Importar 449 OS/ }));
    const alerta = await screen.findByRole("alert");
    expect(alerta.textContent).toMatch(/Falha no lote 2 de 3/);
    expect(alerta.textContent).toMatch(/Nada deste lote foi gravado/);
    expect(chamadas("/os/importar-pendentes/confirmar")).toHaveLength(2);
    fireEvent.click(within(alerta).getByRole("button", { name: "Retomar do lote 2" }));
    await screen.findByText(/Importação concluída/);
    const cs = chamadas("/os/importar-pendentes/confirmar");
    expect(cs).toHaveLength(4); // 1º lote, 2º (falhou), 2º de novo, 3º
    const primeiras = cs.map((c) => (c[1] as { tabela: { linhas: { linha: number }[] } }).tabela.linhas[0]!.linha);
    expect(primeiras).toEqual([2, 203, 203, 403]); // o 1º lote (linhas 2–202, sem a rejeitada 7) NÃO foi reenviado
    expect(nb(document.body.textContent)).toMatch(/600 OS criadas/);
  });

  it("reimportar: lotes 'já existentes' são contados e nada é duplicado", async () => {
    await iniciar(10, { jaExistentes: 9 }, () => lote({ recebidas: 9, criadas: 0, jaExistentes: 9, prioridadePorCodigo: {} }));
    expect(nb(document.body.textContent)).toMatch(/Já existentes9/);
    fireEvent.click(screen.getByRole("button", { name: /Importar 9 OS/ }));
    await screen.findByText(/Importação concluída/);
    expect(nb(document.body.textContent)).toMatch(/0 OS criadas, 9 já existentes \(não duplicadas\)/);
  });

  it("cancelar interrompe depois do lote atual e 'Continuar' retoma de onde parou", async () => {
    let liberar: (v: ConfirmacaoLote) => void = () => {};
    let k = 0;
    h.apiPost.mockImplementation(async (rota: string) => {
      if (rota.endsWith("/preview")) return previa({ entramLinhas: Array.from({ length: 400 }, (_, i) => i + 2), entram: 400, totalLinhas: 400 });
      k++;
      return k === 1 ? new Promise<ConfirmacaoLote>((r) => { liberar = r; }) : lote();
    });
    montar();
    await escolher(arquivo(linhas(400)));
    await previsualizar();
    await screen.findByRole("heading", { name: "Prévia" });
    fireEvent.click(screen.getByRole("button", { name: /Importar 400 OS/ }));
    fireEvent.click(await screen.findByRole("button", { name: /Cancelar/ }));
    liberar(lote());
    await screen.findByText(/Importação interrompida depois do lote 1 de 2/);
    expect(chamadas("/os/importar-pendentes/confirmar")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Continuar" }));
    await screen.findByText(/Importação concluída/);
    expect(chamadas("/os/importar-pendentes/confirmar")).toHaveLength(2);
  });

  it("barra de progresso acessível (valor, máximo e rótulo)", async () => {
    let liberar: (v: ConfirmacaoLote) => void = () => {};
    h.apiPost.mockImplementation(async (rota: string) => (rota.endsWith("/preview") ? previa({ entramLinhas: Array.from({ length: 200 }, (_, i) => i + 2), entram: 200 }) : new Promise<ConfirmacaoLote>((r) => { liberar = r; })));
    montar();
    await escolher(arquivo(linhas(200)));
    await previsualizar();
    await screen.findByRole("heading", { name: "Prévia" });
    fireEvent.click(screen.getByRole("button", { name: /Importar 200 OS/ }));
    const barra = await screen.findByRole("progressbar", { name: "Progresso da importação" });
    expect(barra.getAttribute("aria-valuemax")).toBe("1");
    expect(barra.getAttribute("aria-valuenow")).toBe("0");
    liberar(lote());
    await screen.findByText(/Importação concluída/);
  });

  it("403 no meio da importação: mensagem de permissão, sem 'Retomar'", async () => {
    await iniciar(10, {}, () => { throw new ApiError(403, "Sem permissão"); });
    fireEvent.click(screen.getByRole("button", { name: /Importar 9 OS/ }));
    expect((await screen.findByRole("alert")).textContent).toMatch(/é do Administrador/);
    expect(screen.queryByRole("button", { name: /Retomar/ })).toBeNull();
  });
});
