import { describe, expect, it } from "vitest";
import { linhaParaCandidato, parseCsv, processarImportacaoCsv, type LinhaImportacaoValida, type CandidataDuplicidade } from "./index";

const CABECALHO = "cidade,endereco,lat,lng,transformador,uc,circuito,conjunto,exigeQualificacao,tipo,prazoH";

describe("parseCsv", () => {
  it("separa cabeçalho e linhas, ignora linhas em branco", () => {
    const r = parseCsv(`${CABECALHO}\nBH,Rua A,,,,,,,,,\n\nBH,Rua B,,,,,,,,,\n`);
    expect(r.cabecalho).toEqual(["cidade", "endereco", "lat", "lng", "transformador", "uc", "circuito", "conjunto", "exigeQualificacao", "tipo", "prazoH"]);
    expect(r.registros).toHaveLength(2);
    expect(r.registros[0]!.campos.endereco).toBe("Rua A");
    expect(r.registros[1]!.campos.endereco).toBe("Rua B");
  });

  it("respeita aspas: vírgula e quebra de linha dentro do campo, aspas escapadas", () => {
    const texto = `endereco,obs\n"Rua A, 123\ncomplemento","disse ""oi"""\n`;
    const r = parseCsv(texto);
    expect(r.registros).toHaveLength(1);
    expect(r.registros[0]!.campos.endereco).toBe("Rua A, 123\ncomplemento");
    expect(r.registros[0]!.campos.obs).toBe('disse "oi"');
  });

  it("numera a linha de início de cada registro no arquivo original (não o índice lógico)", () => {
    const texto = `endereco\n"A\nB"\nSegunda\n`;
    const r = parseCsv(texto);
    // cabeçalho = linha 1; 1º registro começa na linha 2 (mesmo ocupando 2 linhas); 2º começa na linha 4.
    expect(r.registros.map((x) => x.linha)).toEqual([2, 4]);
  });

  it("csv vazio não quebra", () => {
    expect(parseCsv("")).toEqual({ cabecalho: [], registros: [] });
  });
});

describe("linhaParaCandidato", () => {
  it("converte números e aceita vazio como ausente", () => {
    const { dados, erros } = linhaParaCandidato({ cidade: "BH", endereco: "Rua A", lat: "-19,9", lng: "-43,9", prazoH: "" });
    expect(erros).toEqual([]);
    expect(dados.lat).toBeCloseTo(-19.9);
    expect(dados.lng).toBeCloseTo(-43.9);
    expect(dados.prazoH).toBeNull();
  });

  it("reporta número inválido em vez de descartar silenciosamente", () => {
    const { erros } = linhaParaCandidato({ cidade: "BH", endereco: "Rua A", lat: "abc" });
    expect(erros).toEqual(['lat: "abc" não é um número válido.']);
  });

  it("reporta tipo fora do enum", () => {
    const { erros } = linhaParaCandidato({ cidade: "BH", endereco: "Rua A", tipo: "Urgente" });
    expect(erros).toEqual(['tipo: "Urgente" inválido (use Corretiva ou Preventiva).']);
  });
});

describe("processarImportacaoCsv", () => {
  const SEM_CANDIDATAS: CandidataDuplicidade[] = [];

  it("linha válida vira NovaOS pronta, sem duplicidade quando não há nada parecido", () => {
    const texto = `${CABECALHO}\nBH,Rua A,,,,,,,,,\n`;
    const r = processarImportacaoCsv(texto, SEM_CANDIDATAS, 0);
    expect(r.totalLinhas).toBe(1);
    expect(r.totalValidas).toBe(1);
    expect(r.totalComErro).toBe(0);
    const [linha] = r.linhas as [LinhaImportacaoValida];
    expect(linha.status).toBe("valida");
    expect(linha.dados.cidade).toBe("BH");
    expect(linha.duplicidade).toEqual([]);
  });

  it("endereço sem cidade vira erro (campo obrigatório do schema)", () => {
    const texto = `${CABECALHO}\n,Rua A,,,,,,,,,\n`;
    const r = processarImportacaoCsv(texto, SEM_CANDIDATAS, 0);
    expect(r.totalComErro).toBe(1);
    expect(r.linhas[0]!.status).toBe("erro");
  });

  it("UC fora do formato (6–10 dígitos) vira erro, igual ao formulário", () => {
    const texto = `${CABECALHO}\nBH,Rua A,,,,123,,,,,\n`;
    const r = processarImportacaoCsv(texto, SEM_CANDIDATAS, 0);
    expect(r.totalComErro).toBe(1);
    expect((r.linhas[0] as { erros: string[] }).erros.join(" ")).toMatch(/UC/);
  });

  it("sinaliza duplicidade contra uma OS já existente, sem bloquear a linha", () => {
    const candidatas: CandidataDuplicidade[] = [{
      id: "os-1", numero: "BH-0001", cidade: "BH", endereco: "Rua A", status: "Aguardando despacho", codigo: 2,
      tipo: "Corretiva", lat: null, lng: null, transformador: null, uc: "2010002", conjunto: null, abertaEmMs: 0,
    }];
    const texto = `${CABECALHO}\nBH,Rua B,,,,2010002,,,,,\n`;
    const r = processarImportacaoCsv(texto, candidatas, 1000);
    expect(r.totalValidas).toBe(1);
    expect(r.totalComDuplicidadeSuspeita).toBe(1);
    const linha = r.linhas[0] as LinhaImportacaoValida;
    expect(linha.duplicidade[0]!.motivos).toContain("mesma_uc");
  });

  it("sinaliza duplicidade ENTRE duas linhas do mesmo arquivo (mesma pane relatada duas vezes)", () => {
    const texto = `${CABECALHO}\nBH,Rua A,,,,2010002,,,,,\nBH,Rua B,,,,2010002,,,,,\n`;
    const r = processarImportacaoCsv(texto, SEM_CANDIDATAS, 0);
    expect(r.totalValidas).toBe(2);
    const [primeira, segunda] = r.linhas as [LinhaImportacaoValida, LinhaImportacaoValida];
    expect(primeira.duplicidade).toEqual([]); // nada antes dela ainda
    expect(segunda.duplicidade[0]!.motivos).toContain("mesma_uc");
  });

  it("cidadeFixa força a cidade em toda linha, mesmo que o CSV não traga a coluna", () => {
    const texto = `endereco,uc\nRua A,2010002\n`;
    const r = processarImportacaoCsv(texto, SEM_CANDIDATAS, 0, undefined, "BH");
    expect(r.totalValidas).toBe(1);
    expect((r.linhas[0] as LinhaImportacaoValida).dados.cidade).toBe("BH");
  });

  it("uma linha com erro não impede as outras de serem processadas", () => {
    const texto = `${CABECALHO}\nBH,Rua A,,,,123,,,,,\nBH,Rua B,,,,,,,,,\n`;
    const r = processarImportacaoCsv(texto, SEM_CANDIDATAS, 0);
    expect(r.totalLinhas).toBe(2);
    expect(r.totalComErro).toBe(1);
    expect(r.totalValidas).toBe(1);
  });
});
