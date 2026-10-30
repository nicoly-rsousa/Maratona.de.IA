import {
  calcularPrioridade, codigoDaCidade, fatosAutomaticos, lotes, statusInicial,
  type ConfigImportacaoOS, type OSPendente, type ResultadoPrioridade, type VersaoPontuacao,
} from "@farol/shared";
import { regrasEmVigor, versaoVigente } from "../config.js";
import { db } from "../db.js";
import { lerTudo } from "./rede.js";
import { utmParaGraus } from "./utm.js";

/** Tudo que é regra vem de `configuracoes` (nada fixo no código). Ausente ou inválido = a importação é recusada (nunca "adivinha"). */
const CHAVES = ["importacao.textos_nulos", "importacao.regiao", "importacao.padrao_poste", "importacao.fuso_horario", "importacao.tamanho_lote"];

export interface ConfigDaImportacao { cfg: ConfigImportacaoOS; tamanhoLote: number }

export async function lerConfigImportacao(): Promise<ConfigDaImportacao | null> {
  const { data, error } = await db.from("configuracoes").select("chave, valor").in("chave", CHAVES);
  if (error || !data) return null;
  const v = new Map(data.map((r) => [r.chave as string, r.valor as unknown]));

  const nulos = v.get("importacao.textos_nulos");
  const reg = v.get("importacao.regiao") as Record<string, unknown> | undefined;
  const padrao = v.get("importacao.padrao_poste");
  const fuso = v.get("importacao.fuso_horario");
  const lote = v.get("importacao.tamanho_lote");

  if (!Array.isArray(nulos) || !nulos.every((x) => typeof x === "string")) return null;
  const n = (k: string) => (reg && typeof reg[k] === "number" && Number.isFinite(reg[k]) ? (reg[k] as number) : null);
  const [latMin, latMax, lngMin, lngMax] = [n("latMin"), n("latMax"), n("lngMin"), n("lngMax")];
  if (latMin === null || latMax === null || lngMin === null || lngMax === null || latMin >= latMax || lngMin >= lngMax) return null;
  if (typeof padrao !== "string") return null;
  try { new RegExp(padrao); } catch { return null; }
  if (typeof fuso !== "string" || !/^[+-]\d{2}:\d{2}$/.test(fuso)) return null;
  if (typeof lote !== "number" || !Number.isInteger(lote) || lote < 1 || lote > 1000) return null;

  return {
    cfg: { textosNulos: nulos as string[], regiao: { latMin, latMax, lngMin, lngMax }, padraoPoste: padrao, fusoHorario: fuso, utmParaGraus },
    tamanhoLote: lote,
  };
}

// ───────── Cidades a partir do município ─────────
export interface CidadeNova { id: string; nome: string; municipio_origem: string }
export interface PlanoDeCidades { mapa: Map<string, string>; novas: CidadeNova[] }

/** Quais municípios já têm cidade (por `municipio_origem`) e quais cidades novas seriam criadas, com código sem colisão. Não grava. */
export async function planejarCidades(municipios: Iterable<string>): Promise<PlanoDeCidades | null> {
  const lidas = await lerTudo<{ id: string; municipio_origem: string | null }>((de, ate) =>
    db.from("cidades").select("id, municipio_origem").order("id").range(de, ate));
  if (lidas.falha) return null;
  const mapa = new Map<string, string>(lidas.linhas.filter((c) => c.municipio_origem).map((c) => [c.municipio_origem!, c.id]));
  const ocupados = new Set(lidas.linhas.map((c) => c.id));
  const novas: CidadeNova[] = [];
  // ordem alfabética: o código gerado não depende da ordem das linhas do arquivo
  for (const m of [...new Set(municipios)].sort((a, b) => a.localeCompare(b, "pt-BR"))) {
    if (mapa.has(m)) continue;
    const id = codigoDaCidade(m, ocupados);
    ocupados.add(id);
    mapa.set(m, id);
    novas.push({ id, nome: m, municipio_origem: m });
  }
  return { mapa, novas };
}

/** Cria as cidades novas. `conflito` = outra importação criou o mesmo município/código no meio do caminho: replaneje e tente de novo. */
export async function criarCidades(novas: CidadeNova[]): Promise<"ok" | "conflito" | "erro"> {
  if (novas.length === 0) return "ok";
  const { error } = await db.from("cidades").insert(novas.map((c) => ({ ...c, ativa: true })));
  if (!error) return "ok";
  return error.code === "23505" ? "conflito" : "erro";
}

/** Garante as cidades dos municípios e devolve município → id (uma segunda tentativa cobre a corrida entre importações). */
export async function garantirCidades(municipios: Iterable<string>): Promise<{ mapa: Map<string, string>; criadas: number } | null> {
  const lista = [...municipios];
  for (let tentativa = 0; tentativa < 2; tentativa++) {
    const plano = await planejarCidades(lista);
    if (!plano) return null;
    const r = await criarCidades(plano.novas);
    if (r === "ok") return { mapa: plano.mapa, criadas: plano.novas.length };
    if (r === "erro") return null;
  }
  return null;
}

// ───────── Itens de gravação (a prioridade vem do motor, como em criarOS) ─────────
export interface ItemDeGravacao {
  numero_origem: string; cidade_id: string; endereco: string; origem_endereco: string; poste_codigo: string | null;
  lat: number | null; lng: number | null; origem_geo: string; circuito: string | null; municipio: string; tipo: "Corretiva";
  fatos: Record<string, never>; status: string; aberta_em: string; prioridade_legada: string | null; clientes: number | null;
  tipo_servico: string | null; familia_ativo: string | null; prazo_origem: string | null;
  versao_pontuacao_id: string; regras_versao: number;
  resultado: { versao: number; itens: ResultadoPrioridade["itens"]; pontos: number; codigoFaixa: number; regrasAplicadas: string[]; nivel: number; codigo: number; motivoPrincipal: string };
}

/**
 * Monta os itens. A prioridade é calculada pelo motor com os fatos que existem: o tipo (Corretiva, padrão do Farol) e a espera.
 * O prazo é DESCONHECIDO (a data da planilha é só informativa, `prazo_origem`): o fato `prazo` é omitido. Os critérios de risco sem
 * resposta caem na opção "Desconhecido" da versão (nunca em zero). Todas as OS do lote têm os mesmos fatos, então o resultado é
 * calculado uma vez por versão.
 */
export async function montarItens(entram: readonly OSPendente[], cidadePorMunicipio: ReadonlyMap<string, string>, agoraMs: number): Promise<ItemDeGravacao[]> {
  const regras = await regrasEmVigor();
  const porCidade = new Map<string, { id: string; versao: VersaoPontuacao }>();
  const resultadoPorVersao = new Map<string, ResultadoPrioridade>();
  const fatos = { tipo: "Corretiva", ...fatosAutomaticos({ aberturaMs: agoraMs, prazoH: null, prazoDesconhecido: true }, agoraMs) };
  const aberta_em = new Date(agoraMs).toISOString();

  const itens: ItemDeGravacao[] = [];
  for (const os of entram) {
    const cidade = cidadePorMunicipio.get(os.municipio);
    if (!cidade) throw new Error(`Município sem cidade: ${os.municipio}`);
    let v = porCidade.get(cidade);
    if (!v) { v = await versaoVigente(cidade); porCidade.set(cidade, v); }
    let r = resultadoPorVersao.get(v.id);
    if (!r) { r = calcularPrioridade(fatos, v.versao, regras.regras); resultadoPorVersao.set(v.id, r); }
    itens.push({
      numero_origem: os.numeroOrigem, cidade_id: cidade, endereco: os.endereco, origem_endereco: os.origemEndereco, poste_codigo: os.posteCodigo,
      lat: os.lat, lng: os.lng, origem_geo: os.origemGeo, circuito: os.setor, municipio: os.municipio, tipo: "Corretiva", fatos: {},
      status: statusInicial(os.lat, os.lng), aberta_em, prioridade_legada: os.prioridadeLegada, clientes: os.clientes,
      tipo_servico: os.tipoServico, familia_ativo: os.familiaAtivo, prazo_origem: os.prazoOrigem,
      versao_pontuacao_id: v.id, regras_versao: regras.numero,
      resultado: {
        versao: r.versao, itens: r.itens, pontos: r.pontos, codigoFaixa: r.codigoFaixa, regrasAplicadas: r.regrasAplicadas,
        nivel: r.nivel, codigo: r.codigo, motivoPrincipal: r.motivoPrincipal,
      },
    });
  }
  return itens;
}

/** Quais números de origem já existem no banco (consulta em blocos). null = falha de leitura. */
export async function numerosJaExistentes(numeros: readonly string[]): Promise<Set<string> | null> {
  const existentes = new Set<string>();
  for (const bloco of lotes(numeros, 500)) {
    const { data, error } = await db.rpc("os_numeros_origem_existentes", { p_numeros: bloco });
    if (error) return null;
    for (const r of (data ?? []) as { numero_origem: string }[]) existentes.add(r.numero_origem);
  }
  return existentes;
}

export interface LinhaGravada { os_numero_origem: string; os_numero: string; os_criada: boolean }

/** Grava um lote de forma atômica e idempotente (função do banco). Falhou = NADA do lote foi gravado e o lote pode ser reenviado. */
export async function gravarLote(itens: ItemDeGravacao[], usuario: string | null): Promise<{ linhas: LinhaGravada[] } | { erro: string }> {
  const { data, error } = await db.rpc("importar_os_pendentes", { p_itens: itens, p_usuario: usuario });
  if (error) return { erro: error.message };
  return { linhas: (data ?? []) as LinhaGravada[] };
}
