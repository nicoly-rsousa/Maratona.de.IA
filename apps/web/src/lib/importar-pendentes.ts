// Cadastro de OS por arquivo no formato "OS manutenção pendente": leitura do CSV NO NAVEGADOR, cliente das rotas e somas dos lotes.
// O navegador projeta SÓ as colunas reconhecidas antes de enviar (as outras colunas do arquivo nunca saem do computador do usuário).
import {
  CAMPOS_OS_PENDENTE, colunasIgnoradas, csvDeRejeitadas, decodificarCsv, lerTabelaCsv, lotes, normalizarCabecalho, projetarTabela,
  type CodigoAviso, type OrigemEndereco, type Rejeitada, type Tabela,
} from "@farol/shared";
import { apiPost } from "./api";

/** Mesmo teto da API (corpo da prévia: tabela enxuta de até 20.000 linhas). */
export const MAX_LINHAS = 20_000;
export const MAX_BYTES = 60 * 1024 * 1024;

export interface PreviaOSPendente {
  totalLinhas: number;
  entram: number;
  /** linhas do arquivo que a prévia aceitou: só estas são confirmadas */
  entramLinhas: number[];
  rejeitadas: Rejeitada[];
  totalRejeitadas: number;
  comAviso: number;
  avisosPorCodigo: Partial<Record<CodigoAviso, number>>;
  avisos: { linha: number; campo: string; codigo: CodigoAviso; mensagem: string }[];
  semCoordenada: number;
  origemEndereco: Record<OrigemEndereco, number>;
  vazios: Record<string, number>;
  colunasReconhecidas: Record<string, string | null>;
  colunasAusentes: string[];
  amostra: { linha: number; numeroOrigem: string; municipio: string; endereco: string; origemEndereco: OrigemEndereco; semCoordenada: boolean; clientes: number | null; prazoOrigem: string | null; prioridadeLegada: string | null }[];
  cidades: { municipios: number; novas: number; existentes: number; exemplosNovas: { municipio: string; codigo: string }[] };
  jaExistentes: number;
  tamanhoLote: number;
}

export interface ConfirmacaoLote {
  recebidas: number;
  criadas: number;
  jaExistentes: number;
  cidadesCriadas: number;
  comAviso: number;
  rejeitadas: { linha: number; motivo: string }[];
  /** quantas OS criadas caíram em cada código de prioridade do Farol (0 = mais urgente) */
  prioridadePorCodigo: Record<string, number>;
}

export const previaImportacao = (tabela: Tabela) => apiPost<PreviaOSPendente>("/os/importar-pendentes/preview", { tabela });
export const confirmarLote = (tabela: Tabela) => apiPost<ConfirmacaoLote>("/os/importar-pendentes/confirmar", { tabela });

// ───────── Leitura do arquivo ─────────
export type LeituraDoArquivo =
  | { ok: true; tabela: Tabela; totalLinhas: number; ignoradas: string[] }
  | { ok: false; erro: string };

/** Bytes do CSV → tabela enxuta. UTF-8 ou Windows-1252, separador `;`, `,` ou tab. Recusa arquivo sem as colunas obrigatórias. */
export function prepararCsv(bytes: Uint8Array): LeituraDoArquivo {
  if (bytes.length > MAX_BYTES) return { ok: false, erro: `Arquivo grande demais (máximo ${Math.round(MAX_BYTES / 1024 / 1024)} MB).` };
  const t = lerTabelaCsv(decodificarCsv(bytes));
  if (t.cabecalho.length === 0 || t.linhas.length === 0) return { ok: false, erro: "O arquivo não tem linhas de dados." };
  const norm = new Set(t.cabecalho.map(normalizarCabecalho));
  const faltam = [CAMPOS_OS_PENDENTE.numero, CAMPOS_OS_PENDENTE.localidade].filter((c) => !norm.has(normalizarCabecalho(c)));
  if (faltam.length) {
    return { ok: false, erro: `O cabeçalho do arquivo não tem ${faltam.length > 1 ? "as colunas obrigatórias" : "a coluna obrigatória"} ${faltam.join(" e ")}. Confira se o arquivo é o "OS manutenção pendente" exportado em CSV.` };
  }
  if (t.linhas.length > MAX_LINHAS) return { ok: false, erro: `O arquivo tem ${t.linhas.length.toLocaleString("pt-BR")} linhas; o máximo por importação é ${MAX_LINHAS.toLocaleString("pt-BR")}. Divida o arquivo.` };
  return { ok: true, tabela: projetarTabela(t), totalLinhas: t.linhas.length, ignoradas: colunasIgnoradas(t) };
}

/** Lê o File por FileReader (funciona em qualquer navegador e no jsdom). */
export function lerArquivo(arquivo: Blob): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(r.error ?? new Error("Não foi possível ler o arquivo."));
    r.onload = () => resolve(new Uint8Array(r.result as ArrayBuffer));
    r.readAsArrayBuffer(arquivo);
  });
}

// ───────── Lotes e somas ─────────
/** Só as linhas aceitas pela prévia, divididas em lotes do tamanho configurado (cada lote vira uma chamada atômica e idempotente). */
export function lotesDaImportacao(tabela: Tabela, entramLinhas: readonly number[], tamanho: number): Tabela[] {
  const aceitas = new Set(entramLinhas);
  const linhas = tabela.linhas.filter((l) => aceitas.has(l.linha));
  return lotes(linhas, tamanho).map((l) => ({ cabecalho: tabela.cabecalho, linhas: l }));
}

export interface Acumulado { lotes: number; criadas: number; jaExistentes: number; cidadesCriadas: number; rejeitadas: { linha: number; motivo: string }[]; porCodigo: Record<string, number> }
export const ACUMULADO_ZERO: Acumulado = { lotes: 0, criadas: 0, jaExistentes: 0, cidadesCriadas: 0, rejeitadas: [], porCodigo: {} };

export function somarLote(a: Acumulado, r: ConfirmacaoLote): Acumulado {
  const porCodigo = { ...a.porCodigo };
  for (const [k, v] of Object.entries(r.prioridadePorCodigo)) porCodigo[k] = (porCodigo[k] ?? 0) + v;
  return {
    lotes: a.lotes + 1, criadas: a.criadas + r.criadas, jaExistentes: a.jaExistentes + r.jaExistentes, cidadesCriadas: a.cidadesCriadas + r.cidadesCriadas,
    rejeitadas: [...a.rejeitadas, ...r.rejeitadas], porCodigo,
  };
}

export const TEXTO_AVISO: Record<CodigoAviso, string> = {
  prazo_invalido: "Prazo (DataDeadline) ilegível: ficou vazio",
  clientes_invalido: "Quantidade de clientes inválida: ficou vazia",
  coordenada_invalida: "Latitude/longitude não numéricas: ficaram vazias",
  coordenada_fora_regiao: "Coordenada fora da região configurada: descartada",
  latlng_incompleto: "Só latitude ou só longitude: não foi usada",
  utm_incompleto: "UTM com só X ou só Y: coordenada vazia",
  utm_invalido: "UTM inválida: coordenada vazia",
  complemento_fora_do_formato: "Complemento de Localização fora do formato de poste: ignorado (texto livre não é copiado)",
  endereco_curto: "Logradouro/Bairro com menos de 3 caracteres: tratado como não informado",
};

export const TEXTO_ORIGEM_ENDERECO: Record<OrigemEndereco, string> = {
  informado: "Informado (Logradouro/Bairro)",
  derivado_poste: "Derivado do poste (Complemento de Localização)",
  nao_informado: "Não informado",
};

/** Arquivo de rejeitadas para baixar: CSV `;` com BOM (o Excel abre com acento certo). Só número da linha, motivo e colunas permitidas. */
export const conteudoDasRejeitadas = (rejeitadas: readonly Rejeitada[]) => "﻿" + csvDeRejeitadas(rejeitadas);
