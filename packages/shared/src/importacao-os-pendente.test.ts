import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import {
  CAMPOS_OS_PENDENTE, CONFIG_PADRAO_IMPORTACAO_OS, analisarOSPendentes, colunasIgnoradas, csvDeRejeitadas, lerTabelaCsv, lotes, normalizarCabecalho, projetarTabela,
  type Celula, type ConfigImportacaoOS, type Tabela,
} from "./importacao-os-pendente";

// SIRGAS 2000 / UTM 23S: mesma projeção do importador (conversão INJETADA: o shared não tem dependências).
const require = createRequire(import.meta.url);
const proj4 = require("proj4");
proj4.defs("EPSG:31983", "+proj=utm +zone=23 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs");
const utm = (x: number, y: number) => {
  const [lng, lat] = proj4("EPSG:31983", "EPSG:4326", [x, y]) as [number, number];
  return { lat, lng };
};
const REGIAO = { latMin: -25, latMax: -17, lngMin: -46, lngMax: -38 }; // só nos testes; em produção vem de configuracoes
const CFG: ConfigImportacaoOS = { ...CONFIG_PADRAO_IMPORTACAO_OS, regiao: REGIAO, utmParaGraus: utm };

const CAB = ["OSNumero", "CodSetor", "CodPrioridade", "DataDeadline", "Quantidade clientes", "Localidade", "Logradouro", "Bairro", "Complemento de Localização",
  "COORDENADA UTM X", "COORDENADA UTM Y", "LATITUDE (Y) - SIRGAS 2000", "LONGITUDE (X) - SIRGAS 2000", "DescEsquema", "Familias"];
type Linha = Partial<Record<string, Celula>>;
const base = (extra: Linha = {}): Linha => ({ OSNumero: "OS-1", Localidade: "MURIAE 48-160", ...extra });
const tabela = (...ls: Linha[]): Tabela => ({ cabecalho: CAB, linhas: ls.map((o, i) => ({ linha: i + 2, valores: CAB.map((c) => o[c] ?? "") })) });
const um = (l: Linha, cfg: ConfigImportacaoOS = CFG) => analisarOSPendentes(tabela(l), cfg);
const primeira = (l: Linha, cfg: ConfigImportacaoOS = CFG) => {
  const r = um(l, cfg);
  expect(r.rejeitadas).toEqual([]);
  return r.entram[0]!;
};
const codigos = (l: Linha, cfg: ConfigImportacaoOS = CFG) => primeira(l, cfg).avisos.map((a) => a.codigo);

describe("leitura da tabela", () => {
  it("normaliza cabeçalho: sem acento, caixa e espaços repetidos", () => {
    expect(normalizarCabecalho("  Complemento  de LOCALIZAÇÃO ")).toBe("complemento de localizacao");
    expect(normalizarCabecalho("Famílias")).toBe(normalizarCabecalho("Familias"));
  });
  it.each([[";"], [","], ["\t"]])("CSV com separador %j é detectado", (sep) => {
    const t = lerTabelaCsv(["OSNumero", "Localidade", "CodSetor"].join(sep) + "\n" + ["OS-1", "MURIAE 1-1", "C-1"].join(sep) + "\n");
    expect(t.cabecalho).toEqual(["OSNumero", "Localidade", "CodSetor"]);
    expect(t.linhas).toEqual([{ linha: 2, valores: ["OS-1", "MURIAE 1-1", "C-1"] }]);
  });
  it("BOM, aspas com separador dentro, aspas escapadas e linhas em branco; guarda a linha física de cada registro", () => {
    const t = lerTabelaCsv('﻿OSNumero;Observacao\n\n"A;1";"disse ""oi"""\n\nB;x\n');
    expect(t.cabecalho[0]).toBe("OSNumero");
    expect(t.linhas).toEqual([{ linha: 3, valores: ["A;1", 'disse "oi"'] }, { linha: 5, valores: ["B", "x"] }]);
  });
  it("campo com quebra de linha entre aspas não desloca a numeração", () => {
    const t = lerTabelaCsv('OSNumero;Obs\n"A";"l1\nl2"\nB;y\n');
    expect(t.linhas.map((l) => l.linha)).toEqual([2, 4]);
  });
  it("cabeçalho repetido: vale a PRIMEIRA ocorrência (como na planilha real, que repete 'CODIGO INSTALACAO')", () => {
    const t: Tabela = { cabecalho: ["OSNumero", "Localidade", "Localidade"], linhas: [{ linha: 2, valores: ["OS-1", "MURIAE 1-1", "OUTRA 9-9"] }] };
    expect(analisarOSPendentes(t, CFG).entram[0]!.municipio).toBe("MURIAE");
  });
  it("arquivo vazio ou só cabeçalho: nenhuma linha", () => {
    expect(lerTabelaCsv("").linhas).toEqual([]);
    expect(lerTabelaCsv("OSNumero;Localidade\n").linhas).toEqual([]);
  });
});

describe("obrigatórios: só número da OS e município (da Localidade)", () => {
  it("só os dois → entra; todo o resto vira NULL (nunca 0 nem texto de preenchimento)", () => {
    const o = primeira(base());
    expect(o).toMatchObject({
      numeroOrigem: "OS-1", municipio: "MURIAE", setor: null, prioridadeLegada: null, prazoOrigem: null, clientes: null,
      lat: null, lng: null, origemGeo: "desconhecido", semCoordenada: true, tipoServico: null, familiaAtivo: null,
    });
    expect(o.avisos).toEqual([]); // vazio não é erro nem aviso
  });
  it("sem número da OS → rejeitada", () => {
    const r = um(base({ OSNumero: "" }));
    expect(r.entram).toEqual([]);
    expect(r.rejeitadas).toHaveLength(1);
    expect(r.rejeitadas[0]!.motivo).toMatch(/sem número da OS/);
    expect(r.rejeitadas[0]!.linha).toBe(2);
  });
  it("sem município (Localidade vazia) → rejeitada", () => {
    const r = um(base({ Localidade: "" }));
    expect(r.rejeitadas[0]!.motivo).toMatch(/sem município/);
  });
  it("Localidade que é só o número final não tem município → rejeitada", () => {
    expect(um(base({ Localidade: "48-160" })).rejeitadas[0]!.motivo).toMatch(/sem município/);
  });
  it("sem número E sem município: um único motivo que cita os dois", () => {
    const r = um({ OSNumero: "  ", Localidade: "" });
    expect(r.rejeitadas[0]!.motivo).toMatch(/sem número da OS e sem município/);
  });
  it("só espaços contam como vazio (tabs e espaços não-quebráveis também)", () => {
    expect(um(base({ OSNumero: " \t  " })).rejeitadas).toHaveLength(1);
    const o = primeira(base({ CodSetor: "   ", Familias: " " }));
    expect(o.setor).toBeNull();
    expect(o.familiaAtivo).toBeNull();
  });
  it("número repetido no arquivo: a primeira entra, as demais são rejeitadas e apontam a linha da primeira", () => {
    const r = analisarOSPendentes(tabela(base(), base(), base({ OSNumero: "OS-2" })), CFG);
    expect(r.entram.map((o) => o.numeroOrigem)).toEqual(["OS-1", "OS-2"]);
    expect(r.rejeitadas).toHaveLength(1);
    expect(r.rejeitadas[0]!.motivo).toMatch(/repetido.*linha 2/);
  });
  it("o número é guardado como veio (só sem as bordas): espaços internos da planilha real são preservados", () => {
    expect(primeira(base({ OSNumero: "  EMG-LDINS3  001100/2026 " })).numeroOrigem).toBe("EMG-LDINS3  001100/2026");
  });
  it("município: tira o número final da Localidade e mantém 'DISTRITO / MUNICÍPIO'", () => {
    expect(primeira(base({ Localidade: "MURIAE 48-160" })).municipio).toBe("MURIAE");
    expect(primeira(base({ Localidade: "MURY / NOVA FRIBURGO 257-1" })).municipio).toBe("MURY / NOVA FRIBURGO");
    expect(primeira(base({ Localidade: "  SÃO   JOÃO   NEPOMUCENO  12-3 " })).municipio).toBe("SÃO JOÃO NEPOMUCENO");
  });
});

describe("campos vazios e texto nulo configurável", () => {
  it("'N/A' e '-' NÃO são nulos por padrão: o texto é mantido", () => {
    expect(CONFIG_PADRAO_IMPORTACAO_OS.textosNulos).toEqual([]);
    expect(primeira(base({ CodSetor: "N/A", DescEsquema: "-" }))).toMatchObject({ setor: "N/A", tipoServico: "-" });
  });
  it("com a lista ligada viram NULL, sem caixa e sem aviso", () => {
    const cfg = { ...CFG, textosNulos: ["N/A", "-"] };
    const o = primeira(base({ CodSetor: " n/a ", DescEsquema: "-", Familias: "REDE" }), cfg);
    expect(o).toMatchObject({ setor: null, tipoServico: null, familiaAtivo: "REDE" });
    expect(o.avisos).toEqual([]);
  });
  it("a lista ligada também vale para obrigatórios: número 'N/A' é vazio → rejeitada", () => {
    expect(um(base({ OSNumero: "N/A" }), { ...CFG, textosNulos: ["N/A"] }).rejeitadas).toHaveLength(1);
  });
  it("zero PRESENTE continua zero (clientes = 0 não é vazio)", () => {
    expect(primeira(base({ "Quantidade clientes": "0" })).clientes).toBe(0);
    expect(primeira(base({ "Quantidade clientes": 0 })).clientes).toBe(0);
  });
});

describe("prazo (DataDeadline) vira prazoOrigem; vazio = desconhecido", () => {
  it("vazio → null, sem aviso", () => {
    const o = primeira(base({ DataDeadline: "" }));
    expect(o.prazoOrigem).toBeNull();
    expect(o.avisos).toEqual([]);
  });
  it.each([
    ["04/01/2026", "2026-01-04T00:00:00-03:00"], ["21/02/2027 14:30", "2027-02-21T14:30:00-03:00"], ["21/02/2027 14:30:15", "2027-02-21T14:30:15-03:00"],
    ["2026-10-21", "2026-10-21T00:00:00-03:00"], ["2026-10-21T08:05:00", "2026-10-21T08:05:00-03:00"],
  ])("%s → %s", (txt, iso) => {
    expect(primeira(base({ DataDeadline: txt })).prazoOrigem).toBe(iso);
  });
  it("objeto Date (célula de data do XLSX) e número serial do Excel", () => {
    expect(primeira(base({ DataDeadline: new Date(Date.UTC(2026, 0, 4)) })).prazoOrigem).toBe("2026-01-04T00:00:00-03:00");
    expect(primeira(base({ DataDeadline: 46026 })).prazoOrigem).toBe("2026-01-04T00:00:00-03:00"); // serial 46026 = 04/01/2026
  });
  it.each([["31/02/2026"], ["32/01/2026"], ["00/10/2026"], ["15/13/2026"], ["29/02/2027"], ["ontem"], ["21/02/26"], ["24:00 21/02/2027"]])(
    "data impossível ou ilegível %j: aceita a linha com AVISO, prazo nulo, nada corrigido", (txt) => {
      const o = primeira(base({ DataDeadline: txt }));
      expect(o.prazoOrigem).toBeNull();
      expect(o.avisos.map((a) => a.codigo)).toEqual(["prazo_invalido"]);
      expect(o.avisos[0]!.mensagem).toContain(txt);
    });
  it("29/02 em ano bissexto é válido", () => {
    expect(primeira(base({ DataDeadline: "29/02/2028" })).prazoOrigem).toBe("2028-02-29T00:00:00-03:00");
  });
  it("hora inválida (25:00) → aviso", () => {
    expect(codigos(base({ DataDeadline: "21/02/2027 25:00" }))).toEqual(["prazo_invalido"]);
  });
});

describe("clientes", () => {
  it.each([["12", 12], ["1234", 1234], ["1.234", 1234], ["1,234", 1234], ["12.345.678", 12345678], [" 7 ", 7], [15, 15]])("%j → %s", (v, n) => {
    expect(primeira(base({ "Quantidade clientes": v as Celula })).clientes).toBe(n);
  });
  it.each([["muitos"], ["12,5"], ["-3"], ["1.23"], ["3 clientes"], [-4], [2.5], [Number.NaN]])("valor presente e inválido %j: aviso, clientes nulo (nunca 0)", (v) => {
    const o = primeira(base({ "Quantidade clientes": v as Celula }));
    expect(o.clientes).toBeNull();
    expect(o.avisos.map((a) => a.codigo)).toEqual(["clientes_invalido"]);
  });
});

describe("coordenadas", () => {
  it("sem nenhuma: entra sinalizada 'sem coordenada' (origem desconhecida), sem aviso", () => {
    const o = primeira(base());
    expect(o).toMatchObject({ lat: null, lng: null, semCoordenada: true, origemGeo: "desconhecido" });
    expect(o.avisos).toEqual([]);
  });
  it("latitude e longitude válidas (vírgula decimal): origem 'informado'", () => {
    const o = primeira(base({ "LATITUDE (Y) - SIRGAS 2000": "-21,168433", "LONGITUDE (X) - SIRGAS 2000": "-43,019892" }));
    expect(o).toMatchObject({ lat: -21.168433, lng: -43.019892, origemGeo: "informado", semCoordenada: false });
  });
  it("UTM com X e Y: converte para graus, origem 'convertido_utm', dentro da região", () => {
    const o = primeira(base({ "COORDENADA UTM X": "700000", "COORDENADA UTM Y": "7700000" }));
    expect(o.origemGeo).toBe("convertido_utm");
    expect(o.semCoordenada).toBe(false);
    expect(o.lat!).toBeGreaterThan(-25); expect(o.lat!).toBeLessThan(-17);
    expect(o.lng!).toBeGreaterThan(-46); expect(o.lng!).toBeLessThan(-38);
  });
  it("UTM só com X: aviso 'utm_incompleto', coordenada nula, entra sem coordenada (e não inventa Y)", () => {
    const o = primeira(base({ "COORDENADA UTM X": "700000" }));
    expect(o).toMatchObject({ lat: null, lng: null, semCoordenada: true, origemGeo: "desconhecido" });
    expect(o.avisos.map((a) => a.codigo)).toEqual(["utm_incompleto"]);
  });
  it("UTM só com Y: idem", () => {
    expect(codigos(base({ "COORDENADA UTM Y": "7700000" }))).toEqual(["utm_incompleto"]);
  });
  it("UTM ilegível (texto): aviso 'utm_invalido', coordenada nula", () => {
    const o = primeira(base({ "COORDENADA UTM X": "abc", "COORDENADA UTM Y": "7700000" }));
    expect(o.lat).toBeNull();
    expect(o.avisos.map((a) => a.codigo)).toEqual(["utm_invalido"]);
  });
  it("UTM que cai fora da região: aviso 'coordenada_fora_regiao', coordenada nula", () => {
    const o = primeira(base({ "COORDENADA UTM X": "166000", "COORDENADA UTM Y": "5000000" }));
    expect(o.lat).toBeNull();
    expect(o.avisos.map((a) => a.codigo)).toEqual(["coordenada_fora_regiao"]);
  });
  it("lat/lng fora da região: aviso, descartadas (e usa a UTM válida, avisando)", () => {
    const o = primeira(base({ "LATITUDE (Y) - SIRGAS 2000": "40,7", "LONGITUDE (X) - SIRGAS 2000": "-74", "COORDENADA UTM X": "700000", "COORDENADA UTM Y": "7700000" }));
    expect(o.origemGeo).toBe("convertido_utm");
    expect(o.avisos.map((a) => a.codigo)).toEqual(["coordenada_fora_regiao"]);
  });
  it("só latitude (sem longitude): aviso 'latlng_incompleto', não usa meia coordenada", () => {
    const o = primeira(base({ "LATITUDE (Y) - SIRGAS 2000": "-21,1" }));
    expect(o).toMatchObject({ lat: null, lng: null, semCoordenada: true });
    expect(o.avisos.map((a) => a.codigo)).toEqual(["latlng_incompleto"]);
  });
  it("lat/lng que não são números: aviso 'coordenada_invalida'", () => {
    expect(codigos(base({ "LATITUDE (Y) - SIRGAS 2000": "sul", "LONGITUDE (X) - SIRGAS 2000": "oeste" }))).toEqual(["coordenada_invalida"]);
  });
  it("sem região configurada, só se confere o intervalo geográfico válido (-90..90, -180..180)", () => {
    const cfg = { ...CFG, regiao: null };
    expect(primeira(base({ "LATITUDE (Y) - SIRGAS 2000": "40,7", "LONGITUDE (X) - SIRGAS 2000": "-74" }), cfg).lat).toBe(40.7);
    expect(codigos(base({ "LATITUDE (Y) - SIRGAS 2000": "95", "LONGITUDE (X) - SIRGAS 2000": "-74" }), cfg)).toEqual(["coordenada_fora_regiao"]);
  });
  it("UTM com valor zero (preenchimento de sistema) não vira coordenada", () => {
    const o = primeira(base({ "COORDENADA UTM X": "0", "COORDENADA UTM Y": "0" }));
    expect(o.lat).toBeNull();
    expect(o.avisos.map((a) => a.codigo)).toEqual(["utm_invalido"]);
  });
});

describe("endereço: NOT NULL preservado, origem registrada, sem copiar texto livre", () => {
  it("informado (Logradouro e/ou Bairro)", () => {
    expect(primeira(base({ Logradouro: "RUA A, 10", Bairro: "CENTRO" }))).toMatchObject({ endereco: "RUA A, 10, CENTRO", origemEndereco: "informado" });
    expect(primeira(base({ Bairro: "CENTRO" }))).toMatchObject({ endereco: "CENTRO", origemEndereco: "informado" });
  });
  it("vazio com Complemento no formato de poste: 'Poste <código> — <município>'", () => {
    const o = primeira(base({ "Complemento de Localização": "48-160" }));
    expect(o).toMatchObject({ endereco: "Poste 48-160 — MURIAE", origemEndereco: "derivado_poste", posteCodigo: "48-160" });
  });
  it("vazio e sem poste: 'Endereço não informado — <município>'", () => {
    expect(primeira(base())).toMatchObject({ endereco: "Endereço não informado — MURIAE", origemEndereco: "nao_informado", posteCodigo: null });
  });
  it("Complemento em texto livre NÃO é copiado: aviso, poste nulo, endereço 'não informado'", () => {
    const livre = "Casa do Sr. João, portão azul, tel 3299999999";
    const o = primeira(base({ "Complemento de Localização": livre }));
    expect(o).toMatchObject({ posteCodigo: null, origemEndereco: "nao_informado", endereco: "Endereço não informado — MURIAE" });
    expect(o.avisos.map((a) => a.codigo)).toEqual(["complemento_fora_do_formato"]);
    expect(JSON.stringify(o)).not.toContain("João");
    expect(JSON.stringify(o)).not.toContain("3299999999");
  });
  it("o padrão do poste é configurável", () => {
    const cfg = { ...CFG, padraoPoste: "^P-\\d+$" };
    expect(primeira(base({ "Complemento de Localização": "P-77" }), cfg).posteCodigo).toBe("P-77");
    expect(codigos(base({ "Complemento de Localização": "48-160" }), cfg)).toEqual(["complemento_fora_do_formato"]);
  });
  it("com Logradouro informado, o poste (se válido) continua registrado à parte", () => {
    expect(primeira(base({ Logradouro: "RUA A", "Complemento de Localização": "9-9" }))).toMatchObject({ origemEndereco: "informado", posteCodigo: "9-9" });
  });
  it("o endereço nunca fica vazio nem com menos de 3 caracteres (NOT NULL e mínimo do Farol)", () => {
    const r = analisarOSPendentes(tabela(base({ OSNumero: "A" }), base({ OSNumero: "B", Bairro: "X" })), CFG);
    for (const o of r.entram) expect(o.endereco.length).toBeGreaterThanOrEqual(3);
  });
});

describe("valor presente e inválido nunca é corrigido em silêncio", () => {
  it("vários problemas na mesma linha: todos os avisos, linha aceita, campos nulos", () => {
    const o = primeira(base({
      DataDeadline: "31/02/2026", "Quantidade clientes": "muitos", "COORDENADA UTM X": "700000", "Complemento de Localização": "texto livre qualquer coisa",
    }));
    expect(o.avisos.map((a) => a.codigo).sort()).toEqual(["clientes_invalido", "complemento_fora_do_formato", "prazo_invalido", "utm_incompleto"]);
    expect(o).toMatchObject({ prazoOrigem: null, clientes: null, lat: null });
    expect(o.avisos.every((a) => a.linha === 2 && a.campo.length > 0 && a.mensagem.length > 5)).toBe(true);
  });
  it("o aviso cita a coluna e o valor original", () => {
    const a = primeira(base({ "Quantidade clientes": "muitos" })).avisos[0]!;
    expect(a).toMatchObject({ codigo: "clientes_invalido", campo: "Quantidade clientes" });
    expect(a.mensagem).toContain("muitos");
  });
});

describe("pré-visualização: o que entra, o que sai, avisos e vazios por coluna", () => {
  const r = analisarOSPendentes(tabela(
    base({ OSNumero: "A", CodSetor: "C-1", DataDeadline: "04/01/2026", "Quantidade clientes": "10", "COORDENADA UTM X": "700000", "COORDENADA UTM Y": "7700000", "Complemento de Localização": "1-1" }),
    base({ OSNumero: "B", "Quantidade clientes": "muitos" }),
    base({ OSNumero: "" }),
    base({ OSNumero: "C", Localidade: "" }),
    base({ OSNumero: "D" }),
  ), CFG);
  it("totais", () => {
    expect(r.totalLinhas).toBe(5);
    expect(r.entram.map((o) => o.numeroOrigem)).toEqual(["A", "B", "D"]);
    expect(r.rejeitadas.map((x) => x.linha)).toEqual([4, 5]);
    expect(r.comAviso).toBe(1);
    expect(r.semCoordenada).toBe(2);
  });
  it("avisos agrupados por código", () => {
    expect(r.avisosPorCodigo).toEqual({ clientes_invalido: 1 });
  });
  it("origem do endereço contada", () => {
    expect(r.origemEndereco).toEqual({ informado: 0, derivado_poste: 1, nao_informado: 2 });
  });
  it("vazios por coluna (todas as linhas, inclusive rejeitadas), pelo nome do cabeçalho", () => {
    expect(r.vazios.Logradouro).toBe(5);
    expect(r.vazios.Bairro).toBe(5);
    expect(r.vazios.CodSetor).toBe(4);
    expect(r.vazios.DataDeadline).toBe(4);
    expect(r.vazios.OSNumero).toBe(1);
    expect(r.vazios.Localidade).toBe(1);
    expect(r.vazios["Quantidade clientes"]).toBe(3);
  });
  it("colunas reconhecidas e ausentes", () => {
    expect(r.colunasAusentes).toEqual([]);
    expect(r.colunasReconhecidas.numero).toBe("OSNumero");
    const sem: Tabela = { cabecalho: ["OSNumero", "Localidade"], linhas: [{ linha: 2, valores: ["A", "MURIAE 1-1"] }] };
    const r2 = analisarOSPendentes(sem, CFG);
    expect(r2.colunasAusentes).toContain("DataDeadline");
    expect(r2.entram).toHaveLength(1); // coluna ausente = tudo vazio, não impede a importação
    expect(r2.vazios.DataDeadline).toBe(1);
  });
  it("sem a coluna OSNumero ou Localidade o arquivo inteiro é recusado com mensagem clara", () => {
    const r3 = analisarOSPendentes({ cabecalho: ["CodSetor", "Localidade"], linhas: [{ linha: 2, valores: ["C-1", "MURIAE 1-1"] }] }, CFG);
    expect(r3.erroEstrutural).toMatch(/OSNumero/);
    expect(r3.entram).toEqual([]);
    expect(r3.rejeitadas).toEqual([]);
    const r4 = analisarOSPendentes({ cabecalho: ["OSNumero"], linhas: [] }, CFG);
    expect(r4.erroEstrutural).toMatch(/Localidade/);
  });
  it("cabeçalho com acento/caixa diferentes ainda é reconhecido", () => {
    const t: Tabela = { cabecalho: ["osnumero", "LOCALIDADE", "complemento de localizacao"], linhas: [{ linha: 2, valores: ["A", "MURIAE 1-1", "5-5"] }] };
    expect(analisarOSPendentes(t, CFG).entram[0]).toMatchObject({ numeroOrigem: "A", posteCodigo: "5-5" });
  });
  it("linha com campos vazios no meio (colunas intermediárias vazias, últimas preenchidas)", () => {
    const o = primeira(base({ CodSetor: "", CodPrioridade: "", DataDeadline: "", "Quantidade clientes": "", Familias: "REDE", DescEsquema: "" }));
    expect(o).toMatchObject({ setor: null, prioridadeLegada: null, prazoOrigem: null, clientes: null, tipoServico: null, familiaAtivo: "REDE" });
  });
  it("linhas totalmente em branco do arquivo são ignoradas pela leitura e não contam como rejeitadas", () => {
    const t = lerTabelaCsv("OSNumero;Localidade\nA;MURIAE 1-1\n;\n\nB;MURIAE 2-2\n");
    // a linha ';' tem dois campos vazios (não é "em branco de verdade"): conta e é rejeitada; a vazia some
    const r5 = analisarOSPendentes(t, CFG);
    expect(r5.totalLinhas).toBe(3);
    expect(r5.entram.map((o) => o.numeroOrigem)).toEqual(["A", "B"]);
    expect(r5.rejeitadas).toHaveLength(1);
  });
});

describe("arquivo de rejeitadas: sem dado pessoal", () => {
  const ls: Linha[] = [
    base({ OSNumero: "", Logradouro: "RUA SECRETA 99", Bairro: "BAIRRO SECRETO", "Complemento de Localização": "Casa do Sr. João", CodSetor: "C-1", DescEsquema: "Poda" }),
    base({ OSNumero: "=cmd|' /C calc'!A0", Localidade: "" }),
  ];
  const r = analisarOSPendentes(tabela(...ls), CFG);
  const csv = csvDeRejeitadas(r.rejeitadas);
  it("traz o número da linha, o motivo e SÓ as colunas permitidas", () => {
    const [cab, l1] = csv.split("\n");
    expect(cab!.split(";").slice(0, 2)).toEqual(["linha", "motivo"]);
    expect(cab).toContain("OSNumero");
    expect(cab).toContain("CodSetor");
    expect(cab).not.toMatch(/Logradouro|Bairro|Complemento/);
    expect(l1!.startsWith("2;")).toBe(true);
  });
  it("nenhum dado pessoal do arquivo de origem aparece (Logradouro, Bairro, Complemento)", () => {
    expect(csv).not.toMatch(/SECRET|João/);
  });
  it("proteção contra injeção de fórmula: células que começam com = + @ ganham apóstrofo", () => {
    expect(csv).toContain("'=cmd");
    expect(csv).not.toMatch(/;=cmd/);
  });
  it("campos com separador, aspas e quebra de linha são escapados", () => {
    const x = csvDeRejeitadas([{ linha: 7, motivo: 'tem; ponto e vírgula e "aspas"', campos: { numero: null, setor: "a\nb" } }]);
    expect(x).toContain('"tem; ponto e vírgula e ""aspas"""');
    expect(x).toContain('"a\nb"');
  });
  it("sem rejeitadas: só o cabeçalho", () => {
    expect(csvDeRejeitadas([]).trim().split("\n")).toHaveLength(1);
  });
  it("números negativos legítimos não são mexidos (coordenadas)", () => {
    const x = csvDeRejeitadas([{ linha: 3, motivo: "m", campos: { lat: "-21,1" } }]);
    expect(x).toContain(";-21,1");
    expect(x).not.toContain("'-21,1");
  });
});

describe("lotes de 200 e idempotência", () => {
  it("450 → 200, 200, 50; 200 → um lote; 0 → nenhum", () => {
    const n = (k: number) => Array.from({ length: k }, (_, i) => i);
    expect(lotes(n(450)).map((l) => l.length)).toEqual([200, 200, 50]);
    expect(lotes(n(200)).map((l) => l.length)).toEqual([200]);
    expect(lotes(n(201)).map((l) => l.length)).toEqual([200, 1]);
    expect(lotes([])).toEqual([]);
  });
  it("tamanho inválido é recusado", () => {
    expect(() => lotes([1, 2], 0)).toThrow();
    expect(() => lotes([1, 2], -5)).toThrow();
  });
  it("o conjunto de números de origem das linhas que entram é único (base da gravação idempotente)", () => {
    const r = analisarOSPendentes(tabela(base({ OSNumero: "A" }), base({ OSNumero: "B" }), base({ OSNumero: "A" })), CFG);
    const nums = r.entram.map((o) => o.numeroOrigem);
    expect(new Set(nums).size).toBe(nums.length);
  });
  it("reimportar o mesmo arquivo produz exatamente o mesmo resultado (função pura, sem estado)", () => {
    const t = tabela(base({ OSNumero: "A", DataDeadline: "04/01/2026" }), base({ OSNumero: "B" }));
    expect(analisarOSPendentes(t, CFG)).toEqual(analisarOSPendentes(t, CFG));
  });
});

describe("CAMPOS_OS_PENDENTE", () => {
  it("nomes de coluna da planilha real", () => {
    expect(CAMPOS_OS_PENDENTE.numero).toBe("OSNumero");
    expect(CAMPOS_OS_PENDENTE.localidade).toBe("Localidade");
    expect(CAMPOS_OS_PENDENTE.complemento).toBe("Complemento de Localização");
  });
});

describe("projetarTabela: só as colunas reconhecidas saem do navegador (privacidade)", () => {
  const larga: Tabela = {
    cabecalho: ["Delta IPDT", "OSNumero", "INSPETOR", "Localidade", "Observação", "complemento de localizacao", "NumSérie", "CodSetor", "OSNumero"],
    linhas: [{ linha: 2, valores: ["x", "OS-1", "FULANO DA SILVA", "MURIAE 1-1", "texto pessoal", "48-160", "999", "LPD-1", "REPETIDA"] }, { linha: 5, valores: ["y", "OS-2", "BELTRANO", "MURIAE 2-2", "", "", "1", "", "OUTRA"] }],
  };
  it("mantém só as reconhecidas, com o NOME canônico e na ordem canônica; descarta as demais", () => {
    const p = projetarTabela(larga);
    expect(p.cabecalho).toEqual(["OSNumero", "CodSetor", "Localidade", "Complemento de Localização"]);
    expect(p.linhas).toEqual([{ linha: 2, valores: ["OS-1", "LPD-1", "MURIAE 1-1", "48-160"] }, { linha: 5, valores: ["OS-2", "", "MURIAE 2-2", ""] }]);
  });
  it("nenhum valor das colunas ignoradas sobra no que seria enviado", () => {
    const json = JSON.stringify(projetarTabela(larga));
    expect(json).not.toMatch(/FULANO|BELTRANO|texto pessoal|INSPETOR|NumSérie|REPETIDA|Delta IPDT/);
  });
  it("cabeçalho repetido: vale a primeira ocorrência", () => {
    expect(projetarTabela(larga).linhas[0]!.valores[0]).toBe("OS-1");
  });
  it("preserva a linha física de cada registro (o relatório aponta a linha certa do arquivo original)", () => {
    expect(projetarTabela(larga).linhas.map((l) => l.linha)).toEqual([2, 5]);
  });
  it("colunas ausentes simplesmente não vão (a análise as trata como vazias)", () => {
    const p = projetarTabela({ cabecalho: ["OSNumero", "Localidade"], linhas: [{ linha: 2, valores: ["A", "MURIAE 1-1"] }] });
    expect(p.cabecalho).toEqual(["OSNumero", "Localidade"]);
  });
  it("analisar a tabela projetada dá o MESMO resultado que analisar a original", () => {
    const a = analisarOSPendentes(larga, CFG);
    const b = analisarOSPendentes(projetarTabela(larga), CFG);
    expect(b.entram).toEqual(a.entram);
    expect(b.rejeitadas).toEqual(a.rejeitadas);
    expect(b.vazios).toEqual(a.vazios);
  });
  it("colunasIgnoradas: só os nomes das colunas que não são usadas (para dizer ao usuário o que NÃO sai do computador)", () => {
    expect(colunasIgnoradas(larga)).toEqual(["Delta IPDT", "INSPETOR", "Observação", "NumSérie", "OSNumero"]);
  });
});
