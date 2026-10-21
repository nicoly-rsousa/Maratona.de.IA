import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONFIG_PADRAO_IMPORTACAO_OS, analisarOSPendentes, decodificarCsv, lerTabelaCsv, lotes, type Celula, type ConfigImportacaoOS, type Tabela,
} from "./importacao-os-pendente";

const require = createRequire(import.meta.url);
const proj4 = require("proj4");
proj4.defs("EPSG:31983", "+proj=utm +zone=23 +south +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs +type=crs");
const CFG: ConfigImportacaoOS = {
  ...CONFIG_PADRAO_IMPORTACAO_OS,
  regiao: { latMin: -25, latMax: -17, lngMin: -46, lngMax: -38 }, // só no teste; em produção vem de configuracoes
  utmParaGraus: (x, y) => { const [lng, lat] = proj4("EPSG:31983", "EPSG:4326", [x, y]) as [number, number]; return { lat, lng }; },
};

describe("decodificarCsv (UTF-8 ou Windows-1252) e o fluxo CSV completo", () => {
  const csv = "OSNumero;Localidade;Complemento de Localização;DescEsquema\nOS-1;MURIAÉ 48-160;48-160;Poda de árvore\n";
  it("UTF-8 é lido como UTF-8", () => {
    expect(decodificarCsv(new TextEncoder().encode(csv))).toBe(csv);
  });
  it("CSV do Excel em Windows-1252 (acentos em 1 byte) é decodificado sem estragar os acentos", () => {
    const bytes = Uint8Array.from(Buffer.from(csv, "latin1"));
    expect(() => new TextDecoder("utf-8", { fatal: true }).decode(bytes)).toThrow(); // não é UTF-8 válido
    expect(decodificarCsv(bytes)).toBe(csv);
  });
  it("pipeline completo em Windows-1252: o cabeçalho 'Complemento de Localização' ainda é reconhecido e o poste é derivado", () => {
    const t = lerTabelaCsv(decodificarCsv(Uint8Array.from(Buffer.from(csv, "latin1"))));
    const r = analisarOSPendentes(t, CFG);
    expect(r.erroEstrutural).toBeNull();
    expect(r.entram[0]).toMatchObject({ municipio: "MURIAÉ", posteCodigo: "48-160", origemEndereco: "derivado_poste", tipoServico: "Poda de árvore" });
  });
  it("lido como UTF-8 por engano, o cabeçalho com acento não casa: a coluna vira ausente (e o resultado deixa isso visível)", () => {
    const errado = new TextDecoder("utf-8").decode(Uint8Array.from(Buffer.from(csv, "latin1")));
    const r = analisarOSPendentes(lerTabelaCsv(errado), CFG);
    expect(r.colunasAusentes).toContain("Complemento de Localização");
  });
});

// ───────── Arquivo REAL (fica fora do Git; o teste se pula sozinho se não estiver na máquina) ─────────
const RAIZ = path.resolve(import.meta.dirname, "../../..");
const ARQUIVO = path.join(RAIZ, "docs/dados/OS manutenção pendente.xlsx");
const tem = existsSync(ARQUIVO);

const txt = (v: unknown): Celula => {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") { const o = v as { richText?: { text: string }[]; result?: unknown; text?: string }; return o.richText ? o.richText.map((p) => p.text).join("") : (o.result as Celula) ?? o.text ?? null; }
  return v as Celula;
};

// Windows-1252 de verdade (o que o Excel brasileiro grava): difere do Latin-1 em 0x80–0x9F ("•" vira 0x95, não uma aspa).
const CP1252: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a,
  0x2039: 0x8b, 0x0152: 0x8c, 0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97,
  0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b, 0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
};
const codificarWindows1252 = (s: string) =>
  Uint8Array.from([...s].map((ch) => { const c = ch.codePointAt(0)!; return c < 0x80 || (c >= 0xa0 && c <= 0xff) ? c : (CP1252[c] ?? 0x3f); }));

const aspas = (s: string) => (/[;"\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
const paraCsv = (t: Tabela) => {
  const linha = (v: Celula[]) => v.map((c) => aspas(c === null || c === undefined ? "" : c instanceof Date ? c.toISOString() : String(c))).join(";");
  return [linha(t.cabecalho), ...t.linhas.map((l) => linha(l.valores))].join("\r\n") + "\r\n";
};

describe.skipIf(!tem)("arquivo real: OS manutenção pendente (4.513 linhas, 95 colunas)", () => {
  let xlsx: Tabela;
  const carregar = async () => {
    if (xlsx) return xlsx;
    const ExcelJS = require("exceljs");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.readFile(ARQUIVO);
    const ws = wb.worksheets[0];
    const cabecalho: string[] = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (c: { value: unknown }, i: number) => { cabecalho[i - 1] = String(txt(c.value) ?? "").trim(); });
    const linhas: Tabela["linhas"] = [];
    for (let r = 2; r <= ws.rowCount; r++) {
      const valores = cabecalho.map((_, i) => txt(ws.getRow(r).getCell(i + 1).value));
      if (valores.some((v) => v !== null && String(v).trim() !== "")) linhas.push({ linha: r, valores });
    }
    return (xlsx = { cabecalho, linhas });
  };

  it("XLSX: todas as 4.513 entram, 0 rejeitadas, Logradouro e Bairro 100% vazios, nenhum prazo vazio", async () => {
    const r = analisarOSPendentes(await carregar(), CFG);
    expect(r.erroEstrutural).toBeNull();
    expect(r.totalLinhas).toBe(4513);
    expect(r.entram).toHaveLength(4513);
    expect(r.rejeitadas).toHaveLength(0);
    expect(r.vazios.Logradouro).toBe(4513);
    expect(r.vazios.Bairro).toBe(4513);
    expect(r.vazios.DataDeadline).toBe(0); // o arquivo real não tem prazo vazio (a regra de prazo vazio é coberta nos testes sintéticos)
    expect(r.vazios["Quantidade clientes"]).toBe(0);
    expect(r.vazios.OSNumero).toBe(0);
    expect(r.vazios.Localidade).toBe(0);
  }, 60_000);

  it("XLSX: endereço derivado do poste em todas, coordenada UTM convertida em todas, nenhum aviso, nenhuma sem coordenada", async () => {
    const r = analisarOSPendentes(await carregar(), CFG);
    expect(r.origemEndereco).toEqual({ informado: 0, derivado_poste: 4513, nao_informado: 0 });
    expect(r.semCoordenada).toBe(0);
    expect(r.entram.every((o) => o.origemGeo === "convertido_utm" && o.lat !== null)).toBe(true);
    expect(r.comAviso).toBe(0);
    expect(r.avisosPorCodigo).toEqual({});
    expect(r.entram.every((o) => o.endereco.startsWith("Poste ") && o.endereco.includes(" — "))).toBe(true);
  }, 60_000);

  it("XLSX: 92 municípios distintos (texto da Localidade sem o código final), 4.513 números de origem únicos", async () => {
    const r = analisarOSPendentes(await carregar(), CFG);
    expect(new Set(r.entram.map((o) => o.municipio)).size).toBe(92);
    expect(new Set(r.entram.map((o) => o.numeroOrigem)).size).toBe(4513);
    expect(r.entram.every((o) => o.prazoOrigem !== null && o.clientes !== null)).toBe(true);
  }, 60_000);

  it("CSV: o MESMO arquivo exportado como CSV ';' em Windows-1252 dá resultado idêntico ao do XLSX (formato principal)", async () => {
    const t = await carregar();
    const bytes = codificarWindows1252(paraCsv(t));
    const viaCsv = analisarOSPendentes(lerTabelaCsv(decodificarCsv(bytes)), CFG);
    const viaXlsx = analisarOSPendentes(t, CFG);
    expect(viaCsv.entram).toHaveLength(4513);
    expect(viaCsv.rejeitadas).toHaveLength(0);
    expect(viaCsv.vazios).toEqual(viaXlsx.vazios);
    expect(viaCsv.origemEndereco).toEqual(viaXlsx.origemEndereco);
    // mesma OS, mesmos campos (a linha física pode diferir se houver quebra de linha dentro de célula)
    const sem = (o: (typeof viaCsv.entram)[number]) => ({ ...o, linha: 0, avisos: [] });
    expect(viaCsv.entram.map(sem)).toEqual(viaXlsx.entram.map(sem));
  }, 120_000);

  it("gravação em lotes de 200: 4.513 → 23 lotes (22 de 200 e 1 de 113), sem perder nem repetir nenhuma OS", async () => {
    const r = analisarOSPendentes(await carregar(), CFG);
    const l = lotes(r.entram);
    expect(l).toHaveLength(23);
    expect(l.slice(0, 22).every((x) => x.length === 200)).toBe(true);
    expect(l[22]).toHaveLength(113);
    expect(l.flat().map((o) => o.numeroOrigem)).toEqual(r.entram.map((o) => o.numeroOrigem));
  }, 60_000);
});
