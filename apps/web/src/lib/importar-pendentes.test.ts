import { describe, expect, it } from "vitest";
import {
  ACUMULADO_ZERO, MAX_LINHAS, TEXTO_AVISO, TEXTO_ORIGEM_ENDERECO, conteudoDasRejeitadas, lotesDaImportacao, prepararCsv, somarLote,
  type ConfirmacaoLote,
} from "./importar-pendentes";

const enc = (s: string) => new TextEncoder().encode(s);
// Windows-1252 simples para o teste: só caracteres com o mesmo byte do Latin-1
const latin1 = (s: string) => Uint8Array.from(Buffer.from(s, "latin1"));

const CAB = "OSNumero;Localidade;Complemento de Localização;INSPETOR;Observação;CodSetor";

describe("prepararCsv", () => {
  it("lê UTF-8 com ';' e projeta só as colunas reconhecidas, com nome canônico", () => {
    const r = prepararCsv(enc(`${CAB}\nOS-1;MURIAE 1-1;48-160;FULANO;texto pessoal;LPD-1\n`));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tabela.cabecalho).toEqual(["OSNumero", "CodSetor", "Localidade", "Complemento de Localização"]);
    expect(r.tabela.linhas).toEqual([{ linha: 2, valores: ["OS-1", "LPD-1", "MURIAE 1-1", "48-160"] }]);
    expect(r.totalLinhas).toBe(1);
    expect(r.ignoradas).toEqual(["INSPETOR", "Observação"]);
  });
  it("PRIVACIDADE: nada das colunas ignoradas sobra na tabela que seria enviada", () => {
    const r = prepararCsv(enc(`${CAB}\nOS-1;MURIAE 1-1;48-160;FULANO DA SILVA;telefone 3299999;LPD-1\n`));
    if (!r.ok) throw new Error("deveria ler");
    expect(JSON.stringify(r.tabela)).not.toMatch(/FULANO|telefone|INSPETOR|Observação/);
  });
  it("lê Windows-1252 (acentos em 1 byte) e reconhece 'Complemento de Localização'", () => {
    const r = prepararCsv(latin1(`${CAB}\nOS-1;MURIAÉ 1-1;48-160;x;y;LPD-1\n`));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tabela.cabecalho).toContain("Complemento de Localização");
    expect(r.tabela.linhas[0]!.valores).toContain("MURIAÉ 1-1");
  });
  it.each([[","], ["\t"]])("detecta o separador %j", (sep) => {
    const r = prepararCsv(enc(["OSNumero", "Localidade"].join(sep) + "\n" + ["OS-1", "MURIAE 1-1"].join(sep) + "\n"));
    expect(r.ok && r.tabela.linhas[0]!.valores).toEqual(["OS-1", "MURIAE 1-1"]);
  });
  it("preserva a linha física (inclusive com quebra de linha dentro de célula de coluna ignorada)", () => {
    const r = prepararCsv(enc('OSNumero;Localidade;Observação\nA;MURIAE 1-1;"duas\nlinhas"\nB;MURIAE 2-2;x\n'));
    if (!r.ok) throw new Error("deveria ler");
    expect(r.tabela.linhas.map((l) => l.linha)).toEqual([2, 4]);
  });
  it("arquivo vazio ou só cabeçalho: erro claro", () => {
    expect(prepararCsv(enc(""))).toMatchObject({ ok: false });
    expect(prepararCsv(enc(`${CAB}\n`))).toMatchObject({ ok: false, erro: expect.stringMatching(/não tem linhas de dados/) });
  });
  it("sem OSNumero ou sem Localidade: recusa e diz qual coluna falta", () => {
    expect(prepararCsv(enc("Localidade;CodSetor\nMURIAE 1-1;x\n"))).toMatchObject({ ok: false, erro: expect.stringMatching(/OSNumero/) });
    expect(prepararCsv(enc("OSNumero;CodSetor\nA;x\n"))).toMatchObject({ ok: false, erro: expect.stringMatching(/Localidade/) });
    const ambas = prepararCsv(enc("CodSetor\nx\n"));
    expect(ambas).toMatchObject({ ok: false, erro: expect.stringMatching(/OSNumero e Localidade/) });
  });
  it("mais linhas que o limite da API: recusa antes de enviar", () => {
    const corpo = "OSNumero;Localidade\n" + Array.from({ length: MAX_LINHAS + 1 }, (_, i) => `N${i};MURIAE 1-1`).join("\n");
    expect(prepararCsv(enc(corpo))).toMatchObject({ ok: false, erro: expect.stringMatching(/máximo por importação/) });
  });
  it("cabeçalho em outra caixa/acento ainda é reconhecido", () => {
    const r = prepararCsv(enc("osnumero;LOCALIDADE\nA;MURIAE 1-1\n"));
    expect(r.ok && r.tabela.cabecalho).toEqual(["OSNumero", "Localidade"]);
  });
});

describe("lotesDaImportacao", () => {
  const t = { cabecalho: ["OSNumero", "Localidade"], linhas: Array.from({ length: 450 }, (_, i) => ({ linha: i + 2, valores: [`N${i}`, "MURIAE 1-1"] })) };
  it("só as linhas aceitas pela prévia, em lotes do tamanho configurado, com o mesmo cabeçalho", () => {
    const aceitas = t.linhas.map((l) => l.linha).filter((l) => l % 10 !== 0);
    const l = lotesDaImportacao(t, aceitas, 200);
    expect(l.map((x) => x.linhas.length)).toEqual([200, 200, aceitas.length - 400]);
    expect(l.flatMap((x) => x.linhas.map((y) => y.linha))).toEqual(aceitas);
    expect(l.every((x) => x.cabecalho === t.cabecalho)).toBe(true);
  });
  it("nenhuma aceita → nenhum lote", () => expect(lotesDaImportacao(t, [], 200)).toEqual([]));
});

describe("somarLote", () => {
  const r = (o: Partial<ConfirmacaoLote> = {}): ConfirmacaoLote => ({ recebidas: 200, criadas: 200, jaExistentes: 0, cidadesCriadas: 1, comAviso: 0, rejeitadas: [], prioridadePorCodigo: { "1": 200 }, ...o });
  it("acumula criadas, existentes, cidades, rejeitadas e a distribuição por prioridade", () => {
    let a = somarLote(ACUMULADO_ZERO, r());
    a = somarLote(a, r({ criadas: 150, jaExistentes: 50, cidadesCriadas: 0, rejeitadas: [{ linha: 9, motivo: "x" }], prioridadePorCodigo: { "1": 100, "0": 50 } }));
    expect(a).toEqual({ lotes: 2, criadas: 350, jaExistentes: 50, cidadesCriadas: 1, rejeitadas: [{ linha: 9, motivo: "x" }], porCodigo: { "1": 300, "0": 50 } });
  });
  it("não altera o acumulado anterior", () => {
    const a = somarLote(ACUMULADO_ZERO, r());
    somarLote(a, r());
    expect(a.criadas).toBe(200);
    expect(ACUMULADO_ZERO.criadas).toBe(0);
  });
});

describe("arquivo de rejeitadas", () => {
  it("começa com BOM (Excel) e só traz colunas permitidas; nada de Logradouro/Bairro/Complemento", () => {
    const c = conteudoDasRejeitadas([{ linha: 3, motivo: "sem município", campos: { numero: "OS-1", setor: "LPD-1" } }]);
    expect(c.charCodeAt(0)).toBe(0xfeff);
    expect(c).toContain("linha;motivo;OSNumero");
    expect(c).not.toMatch(/Logradouro|Bairro|Complemento/);
    expect(c).toContain("3;sem município;OS-1;LPD-1");
  });
});

describe("textos", () => {
  it("há texto para todo código de aviso e toda origem de endereço", () => {
    for (const t of Object.values(TEXTO_AVISO)) expect(t.length).toBeGreaterThan(10);
    expect(Object.keys(TEXTO_ORIGEM_ENDERECO).sort()).toEqual(["derivado_poste", "informado", "nao_informado"]);
  });
});
