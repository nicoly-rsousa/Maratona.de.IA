// Importa o cadastro de unidades consumidoras a partir de uma planilha (xlsx/csv).
//
// Uso (a planilha fictícia não tem coluna de cidade, por isso --cidade=RP é fixo neste import):
//   npm run import:ucs -w @farol/api -- --file="../../docs/dados/Experimento_Dados_Ficticios - BASE CLIENTES 1.xlsx" --cidade=RP --dry-run
//
// --dry-run: só lê o arquivo local e valida as linhas (uc, nome, classe, situação, distância do centro
//   da cidade). NÃO conecta ao Supabase, então funciona mesmo com apps/api/.env quebrado ou ausente.
//   Use para validar a leitura ANTES de importar.
// (sem --dry-run): grava em unidades_consumidoras via upsert (on conflict uc), usando o service_role de
//   apps/api/.env. Ainda não foi executado neste projeto — só escrito para o próximo lote, depois que o
//   .env estiver corrigido e a migration 0008 aplicada.
//
// Mapeamento de colunas (só estas; as demais da planilha são ignoradas — ajuste de UC, item 4):
//   NUMCDC → uc · NOME → nome · CLASSE → classe (casada contra o cadastro classes_cliente)
//   SITUACAO → situacao (normalizada para ATIVO/INATIVO) · DATALIG → data_ligacao (serial do Excel)
//   ENDERECO → endereco · BAIRRO → bairro · LAT → lat · LONG → lng
//   ID_PONTO_ENTREGA → id_ponto_entrega · ID_RAMAL → id_ramal · TRANSFORMADOR → transformador
//   CIRCUITO → circuito · CONJUNTO → conjunto · COD_POSTE → cod_poste · MEDIDOR → medidor
//   TIPO_MEDIDOR → tipo_medidor · FASES → fases · NUM_ROTA → num_rota · NUM_LIVRO → num_livro
//   "cidade" não vem da planilha (ela não tem essa coluna): vem do --cidade da linha de comando.
//
// Trava de distância: UC cuja coordenada fique a mais de --raio-km (padrão 100) do centro da cidade é
// recusada (listada em "fora do raio", não é gravada). O centro vem de --centro-lat/--centro-lng, ou,
// para --cidade=RP, do valor já calculado e gravado na migration 0008 (abaixo) — não recalculado aqui a
// cada rodada, pra não divergir do que está no banco.

import { readFileSync } from "node:fs";
import XLSX from "xlsx";

// Fallback só do dry-run (sem banco). Em import real, o valor vem de configuracoes.uc.formato_regex (0008).
const UC_REGEX_PADRAO = /^\d{6,10}$/;
const SITUACOES_VALIDAS = new Set(["ATIVO", "INATIVO"]);

// Mesmos ids/nomes semeados pela migration 0008 — usado só para o dry-run casar "Comercial" → "comercial".
const CLASSES_CONHECIDAS: Record<string, string> = {
  "poder público": "poder_publico", "poder publico": "poder_publico",
  "rural": "rural", "essencial": "essencial", "residencial": "residencial",
  "comercial": "comercial", "industrial": "industrial",
};

// Centro das cidades conhecidas, pra checar a distância sem precisar consultar o banco no dry-run.
// RP: mesma média de LAT/LONG das 200 linhas da planilha fictícia, gravada na migration 0008 (não
// recalculada aqui — se um dia a cidade RP mudar de centro no banco, passe --centro-lat/--centro-lng).
const CENTROS_CONHECIDOS: Record<string, { lat: number; lng: number }> = {
  RP: { lat: -21.528429, lng: -42.642412 },
};

function distanciaKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371; // raio médio da Terra em km
  const rad = (g: number) => (g * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const COLUNAS: Record<string, string> = {
  NUMCDC: "uc", NOME: "nome", CLASSE: "classe", SITUACAO: "situacao", DATALIG: "data_ligacao",
  ENDERECO: "endereco", BAIRRO: "bairro", LAT: "lat", LONG: "lng",
  ID_PONTO_ENTREGA: "id_ponto_entrega", ID_RAMAL: "id_ramal", TRANSFORMADOR: "transformador",
  CIRCUITO: "circuito", CONJUNTO: "conjunto", COD_POSTE: "cod_poste", MEDIDOR: "medidor",
  TIPO_MEDIDOR: "tipo_medidor", FASES: "fases", NUM_ROTA: "num_rota", NUM_LIVRO: "num_livro",
};

interface Args {
  arquivo: string; cidade: string | null; dryRun: boolean; aba: string | null;
  raioKm: number; centro: { lat: number; lng: number } | null;
}
function lerArgs(): Args {
  const a: Record<string, string | boolean> = {};
  for (const arg of process.argv.slice(2)) {
    const m = arg.match(/^--([^=]+)(?:=(.*))?$/);
    const chave = m?.[1];
    if (chave) a[chave] = m[2] ?? true;
  }
  if (typeof a.file !== "string") throw new Error("uso: --file=<planilha.xlsx> [--cidade=RP] [--sheet=Nome] [--raio-km=100] [--centro-lat=.. --centro-lng=..] [--dry-run]");
  const cidade = typeof a.cidade === "string" ? a.cidade : null;
  const centroLat = typeof a["centro-lat"] === "string" ? Number(a["centro-lat"]) : null;
  const centroLng = typeof a["centro-lng"] === "string" ? Number(a["centro-lng"]) : null;
  const centro = centroLat != null && centroLng != null ? { lat: centroLat, lng: centroLng }
    : (cidade ? CENTROS_CONHECIDOS[cidade] ?? null : null);
  return {
    arquivo: a.file, cidade, dryRun: a["dry-run"] === true, aba: typeof a.sheet === "string" ? a.sheet : null,
    raioKm: typeof a["raio-km"] === "string" ? Number(a["raio-km"]) : 100, centro,
  };
}

// DATALIG vem como serial do Excel (dias desde 1899-12-30); undefined/null/texto já tratado fica null.
function dataExcelParaIso(v: unknown): string | null {
  if (typeof v !== "number") return null;
  const ms = Math.round((v - 25569) * 86400 * 1000); // 25569 = dias entre 1899-12-30 e 1970-01-01
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function classeParaId(valor: unknown): { id: string | null; bruta: string | null } {
  if (valor == null || valor === "") return { id: null, bruta: null };
  const bruta = String(valor);
  const chave = bruta.trim().toLowerCase();
  return { id: CLASSES_CONHECIDAS[chave] ?? null, bruta };
}

// SITUACAO vem livre da planilha ("ATIVO", "Ativo"...); aqui normaliza pros dois códigos fixos da 0008.
function situacaoParaCodigo(valor: unknown): { codigo: string | null; bruta: string | null } {
  if (valor == null || valor === "") return { codigo: null, bruta: null };
  const bruta = String(valor);
  const normalizada = bruta.trim().toUpperCase();
  return { codigo: SITUACOES_VALIDAS.has(normalizada) ? normalizada : null, bruta };
}

interface LinhaMapeada {
  linha: number; uc: string | null; nome: string | null; classe: string | null; classeBruta: string | null;
  situacao: string | null; situacaoBruta: string | null; data_ligacao: string | null; endereco: string | null;
  bairro: string | null; cidade: string | null; lat: number | null; lng: number | null;
  id_ponto_entrega: string | null; id_ramal: string | null; transformador: string | null;
  circuito: string | null; conjunto: string | null; cod_poste: string | null; medidor: string | null;
  tipo_medidor: string | null; fases: string | null; num_rota: string | null; num_livro: string | null;
  distanciaKm: number | null; erros: string[]; foraDoRaio: boolean;
}

function mapear(linhasBrutas: Record<string, unknown>[], args: Args): LinhaMapeada[] {
  const { cidade, centro, raioKm } = args;
  const vistas = new Set<string>();
  return linhasBrutas.map((bruta, i) => {
    const linha = i + 2; // +1 cabeçalho, +1 base 1
    const texto = (chave: string) => { const v = bruta[chave]; return v == null || v === "" ? null : String(v).trim(); };
    const numero = (chave: string) => { const v = bruta[chave]; return typeof v === "number" ? v : v ? Number(v) : null; };
    const uc = texto("NUMCDC");
    const { id: classe, bruta: classeBruta } = classeParaId(bruta["CLASSE"]);
    const { codigo: situacao, bruta: situacaoBruta } = situacaoParaCodigo(bruta["SITUACAO"]);
    const lat = numero("LAT"), lng = numero("LONG");
    let distancia: number | null = null;
    let foraDoRaio = false;
    if (centro && lat != null && lng != null && Number.isFinite(lat) && Number.isFinite(lng)) {
      distancia = distanciaKm(centro, { lat, lng });
      foraDoRaio = distancia > raioKm;
    }

    const erros: string[] = [];
    if (!uc) erros.push("UC (NUMCDC) vazia");
    else if (!UC_REGEX_PADRAO.test(uc)) erros.push(`UC "${uc}" fora do formato padrão ^\\d{6,10}$ (dry-run usa o padrão; confirme uc.formato_regex no banco)`);
    if (uc && vistas.has(uc)) erros.push(`UC "${uc}" duplicada dentro do arquivo`);
    if (uc) vistas.add(uc);
    if (!texto("NOME")) erros.push("nome vazio");
    if (classeBruta && !classe) erros.push(`classe "${classeBruta}" não corresponde a nenhuma classe cadastrada (classes_cliente)`);
    if (situacaoBruta && !situacao) erros.push(`situação "${situacaoBruta}" não é ATIVO nem INATIVO`);
    if (!cidade) erros.push("--cidade não informado na linha de comando (a planilha não tem coluna de cidade)");
    else if (!centro) erros.push(`centro da cidade "${cidade}" desconhecido (passe --centro-lat/--centro-lng) — não dá pra checar a distância de 100 km`);
    if (foraDoRaio) erros.push(`a ${distancia!.toFixed(1)} km do centro de "${cidade}" (limite ${raioKm} km)`);

    return {
      linha, uc, nome: texto("NOME"), classe, classeBruta, situacao, situacaoBruta,
      data_ligacao: dataExcelParaIso(bruta["DATALIG"]), endereco: texto("ENDERECO"), bairro: texto("BAIRRO"),
      cidade, lat, lng,
      id_ponto_entrega: texto("ID_PONTO_ENTREGA"), id_ramal: texto("ID_RAMAL"), transformador: texto("TRANSFORMADOR"),
      circuito: texto("CIRCUITO"), conjunto: texto("CONJUNTO"), cod_poste: texto("COD_POSTE"), medidor: texto("MEDIDOR"),
      tipo_medidor: texto("TIPO_MEDIDOR"), fases: texto("FASES"), num_rota: texto("NUM_ROTA"), num_livro: texto("NUM_LIVRO"),
      distanciaKm: distancia, erros, foraDoRaio,
    };
  });
}

async function main() {
  const args = lerArgs();
  const { arquivo, cidade, dryRun, aba } = args;
  const planilha = XLSX.readFile(arquivo);
  const nomeAba = aba ?? planilha.SheetNames[0];
  if (!nomeAba) throw new Error("planilha sem nenhuma aba");
  const folha = planilha.Sheets[nomeAba];
  if (!folha) throw new Error(`aba "${nomeAba}" não existe. abas disponíveis: ${planilha.SheetNames.join(", ")}`);
  const brutas = XLSX.utils.sheet_to_json<Record<string, unknown>>(folha, { defval: null });

  const colunasIgnoradas = Object.keys(brutas[0] ?? {}).filter((c) => !(c in COLUNAS) && c !== "NUMCDC" && c !== "NOME" && c !== "CLASSE");
  const linhas = mapear(brutas, args);
  const validas = linhas.filter((l) => l.erros.length === 0);
  const invalidas = linhas.filter((l) => l.erros.length > 0);
  const foraDoRaio = linhas.filter((l) => l.foraDoRaio);

  console.log(`arquivo: ${arquivo}`);
  console.log(`aba: ${nomeAba} · ${linhas.length} linha(s) de dados`);
  console.log(`colunas ignoradas (fora da lista de 0008): ${colunasIgnoradas.join(", ") || "(nenhuma)"}`);
  console.log(`cidade: ${cidade ?? "—"} · centro usado: ${args.centro ? `${args.centro.lat}, ${args.centro.lng}` : "nenhum (não dá pra checar distância)"} · raio: ${args.raioKm} km`);
  console.log(`válidas: ${validas.length} · inválidas: ${invalidas.length} (das quais ${foraDoRaio.length} fora do raio)`);
  if (foraDoRaio.length) {
    console.log("\nexceções — fora do raio de 100 km (não serão importadas):");
    for (const l of foraDoRaio) console.log(`  linha ${l.linha} (uc=${l.uc ?? "—"}): ${l.distanciaKm!.toFixed(1)} km do centro`);
  }
  if (invalidas.length) {
    console.log("\nprimeiras linhas inválidas (inclui as exceções de raio acima):");
    for (const l of invalidas.slice(0, 15)) console.log(`  linha ${l.linha} (uc=${l.uc ?? "—"}): ${l.erros.join("; ")}`);
    if (invalidas.length > 15) console.log(`  … e mais ${invalidas.length - 15}`);
  }
  if (validas.length) {
    console.log("\namostra (primeiras 2 linhas válidas, já mapeadas para as colunas de 0008):");
    for (const l of validas.slice(0, 2)) {
      const { erros, linha, classeBruta, situacaoBruta, distanciaKm: _d, foraDoRaio: _f, ...registro } = l;
      console.log(`  linha ${linha}:`, JSON.stringify(registro));
    }
  }

  if (dryRun) {
    console.log("\n--dry-run: nada foi gravado. Nenhuma conexão com o Supabase foi aberta.");
    return;
  }

  if (invalidas.length) {
    console.error(`\nhá ${invalidas.length} linha(s) inválida(s); corrija ou rode com --dry-run para revisar antes de importar. Nada foi gravado.`);
    process.exitCode = 1;
    return;
  }

  // Import real: só chega aqui com --dry-run explicitamente omitido e nenhuma linha inválida.
  const { parseEnv } = await import("node:util");
  const { createClient } = await import("@supabase/supabase-js");
  const env = parseEnv(readFileSync(new URL("../.env", import.meta.url), "utf8"));
  if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY) throw new Error("apps/api/.env sem SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY válidos");
  const db = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  const registros = validas.map(({ erros, linha, classeBruta, situacaoBruta, distanciaKm: _d, foraDoRaio: _f, ...r }) =>
    ({ ...r, origem: "importado", importado_em: new Date().toISOString() }));
  const TAMANHO_LOTE = 500;
  let gravadas = 0;
  for (let i = 0; i < registros.length; i += TAMANHO_LOTE) {
    const lote = registros.slice(i, i + TAMANHO_LOTE);
    const { error } = await db.from("unidades_consumidoras").upsert(lote, { onConflict: "uc" });
    if (error) throw new Error(`upsert falhou no lote a partir do índice ${i}: ${error.message}`);
    gravadas += lote.length;
  }
  console.log(`\n${gravadas} UC(s) gravada(s)/atualizada(s) em unidades_consumidoras.`);
}

main().catch((e) => { console.error(e.message ?? e); process.exitCode = 1; });
