// Funções PURAS do mapa da rede (sem I/O, sem React, sem Leaflet): cores, rótulos, formatação, cache e mensagens.
// Nenhum peso, faixa, prazo ou regra de negócio aqui: o código de prioridade já vem mapeado pela API (configuracoes).
import { CODIGOS, nomeTipoUnidade, segmentoVisivel } from "@farol/shared";
import { ApiError } from "./api";
import type { Chaves, CircuitoOrigem, FeicaoChave, FeicaoLinha, Tracado, TransformadorRede } from "./rede-api";

/** /rede/os é buscado uma vez e guardado por 5 min só no front; o usuário pode recarregar. */
export const CACHE_OS_MS = 5 * 60_000;
/** debounce do slider de raio */
export const DEBOUNCE_RAIO_MS = 150;

// ───────── Prioridade legada (informativa) ─────────
export type ChavePrioridade = "c0" | "c1" | "c2" | "c3" | "c4" | "sem-mapa";
export interface EstiloPrioridade {
  chave: ChavePrioridade;
  /** variável CSS do tema (--c0…--c4); null em "sem mapa" */
  variavelCss: string | null;
  rotulo: string;
  semMapa: boolean;
}

/** Cinza neutro de "sem mapa". O --c4 (Baixa) também é acinzentado: "sem mapa" ganha contorno tracejado, nunca só cor. */
export const COR_SEM_MAPA = "#888888";
export const ROTULO_SEM_MAPA = "Sem mapa";

/** Código 0–4 inteiro → estilo da classe. Qualquer outra coisa (null, indefinido, 7, 1,5) é SEM MAPA, nunca "0". */
export function estiloDaPrioridade(codigo: number | null | undefined): EstiloPrioridade {
  if (typeof codigo === "number" && Number.isInteger(codigo) && codigo >= 0 && codigo < CODIGOS.length) {
    return { chave: `c${codigo}` as ChavePrioridade, variavelCss: `--c${codigo}`, rotulo: CODIGOS[codigo]!, semMapa: false };
  }
  return { chave: "sem-mapa", variavelCss: null, rotulo: ROTULO_SEM_MAPA, semMapa: true };
}

export interface ItemLegenda { chave: ChavePrioridade; rotulo: string; qtd: number }

/** Legenda da visão geral: as 5 classes (0 = mais urgente) e "sem mapa", sempre presentes, mesmo com zero OS. */
export function legendaDePrioridades(os: readonly { prioridade_codigo: number | null }[]): ItemLegenda[] {
  const contagem = new Map<ChavePrioridade, number>();
  for (const o of os) {
    const k = estiloDaPrioridade(o.prioridade_codigo).chave;
    contagem.set(k, (contagem.get(k) ?? 0) + 1);
  }
  const ordem: (number | null)[] = [...CODIGOS.keys(), null];
  return ordem.map((c) => {
    const e = estiloDaPrioridade(c);
    return { chave: e.chave, rotulo: e.rotulo, qtd: contagem.get(e.chave) ?? 0 };
  });
}

export const AVISO_ORDEM_INFORMATIVA = "Ordem informativa pela prioridade legada mapeada; não é a fila de prioridade do Farol.";
export const LEGENDA_INFORMATIVA = "Prioridade legada (informativa, não é a fila do Farol)";

// ───────── OS sem circuito identificado ─────────
export const AVISO_SEM_CIRCUITO =
  "Circuito não identificado: o código da OS não existe nas bases de rede. Não é corrigido automaticamente; a operação revisa.";

/** OS cujo circuito a importação não conseguiu identificar (ou veio vazio). A coordenada continua válida. */
export function semCircuitoIdentificado<T extends { circuito: string | null; circuito_origem: CircuitoOrigem | null }>(os: readonly T[]): T[] {
  return os.filter((o) => o.circuito === null || o.circuito_origem === "nao_identificado");
}

// ───────── Formatação ─────────
const PT = "pt-BR";

/** Desconhecido (null) é escrito "desconhecido", nunca 0. */
export function formatarClientes(n: number | null | undefined): string {
  return typeof n === "number" && Number.isFinite(n) ? n.toLocaleString(PT) : "desconhecido";
}

export interface ResumoClientes { total: string; ligados: string; desligados: string }
export function resumoDeClientes(c: { clientes_total: number | null; clientes_ligados: number | null; clientes_desligados: number | null }): ResumoClientes {
  return { total: formatarClientes(c.clientes_total), ligados: formatarClientes(c.clientes_ligados), desligados: formatarClientes(c.clientes_desligados) };
}

/** 850 → "850 m"; 1000 → "1 km"; 1500 → "1,5 km". Serve para raio e distância (linha reta). */
export function formatarMetros(m: number): string {
  if (!Number.isFinite(m)) return "—";
  const r = Math.round(m); // arredonda ANTES de escolher a unidade: 999,6 m vira "1 km", nunca "1000 m"
  if (r < 1000) return `${r} m`;
  return `${(r / 1000).toLocaleString(PT, { maximumFractionDigits: 1 })} km`;
}

/** "dados importados em 19/10/2026 às 01:00" (fuso opcional, para testes determinísticos). */
export function textoDataImportacao(iso: string | null | undefined, timeZone?: string): string {
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return "data da importação desconhecida";
  const d = new Date(t);
  const dia = new Intl.DateTimeFormat(PT, { dateStyle: "short", timeZone }).format(d);
  const hora = new Intl.DateTimeFormat(PT, { timeStyle: "short", timeZone }).format(d);
  return `dados importados em ${dia} às ${hora}`;
}

// ───────── Cache de /rede/os (só no front) ─────────
export const cacheExpirado = (carregadoEm: number | null, agora: number = Date.now(), validadeMs: number = CACHE_OS_MS) =>
  carregadoEm === null || agora - carregadoEm >= validadeMs;

// ───────── Traçado e chaves ─────────
/** Visibilidade pela REDE (LV = baixa tensão), nunca pelo trecho: há segmentos LV de trecho 3 (ficam verdes). */
export function filtrarTracado(t: Tracado | undefined, incluirBaixaTensao: boolean): FeicaoLinha[] {
  return (t?.features ?? []).filter((f) => segmentoVisivel({ rede: f.properties.rede }, incluirBaixaTensao));
}

export interface ItemLegendaChave { nome: string; qtd: number }
/** Legenda das chaves pelo NOME do tipo ("Chave Fusível"), da mais numerosa para a menos. */
export function legendaDeChaves(c: Chaves | FeicaoChave[] | undefined): ItemLegendaChave[] {
  const feicoes = Array.isArray(c) ? c : (c?.features ?? []);
  const m = new Map<string, number>();
  for (const f of feicoes) {
    const n = nomeTipoUnidade(f.properties.tipo_unidade);
    m.set(n, (m.get(n) ?? 0) + 1);
  }
  return [...m].map(([nome, qtd]) => ({ nome, qtd })).sort((a, b) => b.qtd - a.qtd || a.nome.localeCompare(b.nome, PT));
}

// ───────── Transformadores ─────────
export const TEXTO_APOIO_TRANSFORMADORES =
  "Clientes identificados: cerca de 24% dos clientes da base não têm circuito, então os totais podem estar subestimados.";

export interface ResumoTransformadores { total: number; comPosicao: number; semPosicao: number; clientesIdentificados: number }
export const temPosicao = (t: Pick<TransformadorRede, "lat" | "lng">): t is { lat: number; lng: number } =>
  typeof t.lat === "number" && typeof t.lng === "number" && Number.isFinite(t.lat) && Number.isFinite(t.lng);

export function resumirTransformadores(lista: readonly TransformadorRede[] | undefined): ResumoTransformadores {
  const l = lista ?? [];
  const comPosicao = l.filter(temPosicao).length;
  return { total: l.length, comPosicao, semPosicao: l.length - comPosicao, clientesIdentificados: l.reduce((s, t) => s + (t.clientes || 0), 0) };
}
export const textoSemPosicao = (n: number) => `${n.toLocaleString(PT)} ${n === 1 ? "transformador sem posição" : "transformadores sem posição"}`;

/** Raio (px) do círculo do transformador: cresce com a raiz do nº de clientes, limitado a [6, 22]. */
export function raioDoCirculoTransformador(clientes: number): number {
  const c = Number.isFinite(clientes) && clientes > 0 ? clientes : 0;
  return Math.min(22, Math.max(6, Math.round(4 + 2 * Math.sqrt(c))));
}

// ───────── Erros e mensagens ─────────
export const statusDoErro = (e: unknown): number => (e instanceof ApiError ? e.status : 0);
/** 401 (sessão inválida no servidor): a tela volta ao login. */
export const exigeNovoLogin = (e: unknown) => statusDoErro(e) === 401;

export type TipoMensagem = "ok" | "aviso" | "erro";
export interface Mensagem { tipo: TipoMensagem; texto: string }

/** Feedback de "sugerir junto" por status. 422/400 repetem o motivo que a API devolveu. Só registra; não designa equipe. */
export function mensagemDaSugestao(status: number, msgApi?: string): Mensagem {
  switch (status) {
    case 201: return { tipo: "ok", texto: "Sugestão registrada. Nenhuma equipe foi designada e a fila não mudou." };
    case 409: return { tipo: "aviso", texto: "Essa sugestão já foi registrada para este par de OS (A→B e B→A contam como a mesma)." };
    case 422: return { tipo: "erro", texto: `Não foi possível registrar: ${msgApi ?? "a OS sugerida não atende aos critérios (fora do raio ou do mesmo circuito)."}` };
    case 400: return { tipo: "erro", texto: `Pedido inválido: ${msgApi ?? "confira o raio e as OS escolhidas."}` };
    case 403: return { tipo: "erro", texto: "Seu perfil não pode registrar sugestões." };
    case 401: return { tipo: "erro", texto: "Sua sessão expirou. Entre novamente." };
    case 404: return { tipo: "erro", texto: "OS não encontrada. Recarregue os dados." };
    case 0: return { tipo: "erro", texto: "Não foi possível falar com o servidor." };
    default: return { tipo: "erro", texto: `Erro ${status}${msgApi ? `: ${msgApi}` : "."}` };
  }
}

/** Mensagem de acesso ao módulo. O 403 vale para Equipe de campo e para os demais perfis fora da lista (o servidor decide). */
export function mensagemDeAcessoRede(status: number, msgApi?: string): Mensagem {
  switch (status) {
    case 403: return { tipo: "erro", texto: "Seu perfil não tem acesso ao Mapa da rede. O acesso é definido pela administração; a tentativa foi registrada." };
    case 401: return { tipo: "erro", texto: "Sua sessão expirou. Entre novamente." };
    case 404: return { tipo: "erro", texto: msgApi ?? "Não encontrado." };
    case 0: return { tipo: "erro", texto: "Não foi possível falar com o servidor." };
    default: return { tipo: "erro", texto: msgApi ?? `Erro ${status}.` };
  }
}
