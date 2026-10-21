// Funções PURAS do circuito selecionado (fase 3): busca, traçado por trecho, chaves, contorno aproximado, enquadramento e textos.
// Sem I/O, sem React e sem Leaflet. Nenhuma regra de negócio: o que vem do banco/API só é apresentado.
import { contornoAproximado, corDoTrecho, COR_TRECHO_DESCONHECIDO, nomeTipoUnidade, type Contorno, type Ponto } from "@farol/shared";
import type { CircuitoResumo, FeicaoChave, FeicaoLinha, OSRedeLeve, TransformadorRede } from "./rede-api";
import { limitesDasOS, temCoordenada, type Limites, type ModoPonto } from "./rede-mapa";
import { temPosicao } from "./rede";

const PT = "pt-BR";

// ───────── Busca de circuitos ─────────
/** minúsculas, sem acento e SÓ letras/números: "CET-LUM 2" e "cetlum2" viram a mesma coisa (há grafias divergentes entre as bases). */
export const normalizarCodigo = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Busca por trecho do código, ignorando espaço, hífen e caixa. Sem termo: os circuitos com mais OS primeiro.
 * Com termo: prefixo antes de "contém"; desempate por mais OS e depois por código.
 */
export function buscarCircuitos(lista: readonly CircuitoResumo[], termo: string, max = 30): CircuitoResumo[] {
  const t = normalizarCodigo(termo);
  const porOS = (a: CircuitoResumo, b: CircuitoResumo) => b.qtd_os - a.qtd_os || a.codigo.localeCompare(b.codigo, PT);
  if (t === "") return [...lista].sort(porOS).slice(0, max);
  const achados = lista
    .map((c) => ({ c, n: normalizarCodigo(c.codigo) }))
    .filter((x) => x.n.includes(t))
    .map((x) => ({ c: x.c, prefixo: x.n.startsWith(t) }));
  achados.sort((a, b) => Number(b.prefixo) - Number(a.prefixo) || porOS(a.c, b.c));
  return achados.slice(0, max).map((x) => x.c);
}

/**
 * Circuito a abrir ao clicar numa OS: só o código JÁ identificado pela importação. OS de circuito "não identificado" NUNCA abre
 * circuito sozinha (nenhuma correção automática de grafia); o usuário escolhe na busca.
 */
export function circuitoDaOS(o: Pick<OSRedeLeve, "circuito" | "circuito_origem">, conhecidos: ReadonlySet<string>): string | null {
  if (o.circuito === null || o.circuito_origem === "nao_identificado") return null;
  return conhecidos.has(o.circuito) ? o.circuito : null;
}

// ───────── OS na visão do circuito ─────────
/** Com circuito selecionado, as OS dele ganham destaque e as demais ficam esmaecidas (continuam visíveis). */
export function modoDoPonto(o: Pick<OSRedeLeve, "circuito" | "circuito_origem">, circuitoSelecionado: string | null): ModoPonto {
  if (circuitoSelecionado === null) return "normal";
  return o.circuito === circuitoSelecionado && o.circuito_origem !== "nao_identificado" ? "destaque" : "esmaecida";
}

// ───────── Traçado por trecho ─────────
export interface ItemLegendaTracado { trecho: number | null; cor: string; rotulo: string; qtd: number; baixaTensao: number }

/** Cor pelo campo `trecho` (1 #e31a1c, 2 #121dd9, 3 #069e17, 4 #ff7f00). A baixa tensão (rede LV) só decide a visibilidade, não a cor. */
export function estiloDoSegmento(f: FeicaoLinha): { color: string; weight: number; opacity: number } {
  return { color: corDoTrecho(f.properties.trecho), weight: f.properties.rede === "LV" ? 2.5 : 4, opacity: 0.9 };
}

/** Legenda só dos trechos que existem no traçado exibido, em ordem; conta quantos segmentos são de baixa tensão. */
export function legendaDoTracado(features: readonly FeicaoLinha[]): ItemLegendaTracado[] {
  const m = new Map<number | null, ItemLegendaTracado>();
  for (const f of features) {
    const t = typeof f.properties.trecho === "number" ? f.properties.trecho : null;
    const i = m.get(t) ?? { trecho: t, cor: corDoTrecho(t), rotulo: t === null ? "Trecho desconhecido" : `Trecho ${t}`, qtd: 0, baixaTensao: 0 };
    i.qtd++;
    if (f.properties.rede === "LV") i.baixaTensao++;
    m.set(t, i);
  }
  return [...m.values()].sort((a, b) => (a.trecho ?? 99) - (b.trecho ?? 99));
}

export const COR_TRACADO_DESCONHECIDO = COR_TRECHO_DESCONHECIDO;

export const textoDoSegmento = (f: FeicaoLinha) =>
  `${f.properties.rede === "LV" ? "Baixa tensão" : "Média tensão"} · ${f.properties.trecho === null ? "trecho desconhecido" : `trecho ${f.properties.trecho}`} · ${f.properties.id}`;

// ───────── Chaves ─────────
/** Paleta sem vermelho/azul/verde/laranja puros (essas cores são do traçado) e com contraste sobre o mapa claro. */
export const PALETA_CHAVES = ["#111111", "#7b3294", "#8c6d31", "#e7298a", "#17a2b8", "#7f7f7f", "#a6761d", "#5e3c99"] as const;

/** Cor por NOME de tipo, estável: atribuída em ordem alfabética (não muda quando a contagem muda). */
export function coresDosTiposDeChave(nomes: Iterable<string>): Record<string, string> {
  const unicos = [...new Set(nomes)].sort((a, b) => a.localeCompare(b, PT));
  return Object.fromEntries(unicos.map((n, i) => [n, PALETA_CHAVES[i % PALETA_CHAVES.length]!]));
}

export const nomeDoTipoDaChave = (f: FeicaoChave) => nomeTipoUnidade(f.properties.tipo_unidade);

export const textoDaChave = (f: FeicaoChave) => {
  const op = f.properties.numero_operativo ? ` · ${f.properties.numero_operativo}` : "";
  return `${nomeDoTipoDaChave(f)}${op}`;
};

// ───────── Contorno aproximado ─────────
export const pontosDasChaves = (chaves: readonly FeicaoChave[]): Ponto[] =>
  chaves.map((c) => ({ lat: c.geometry.coordinates[1], lng: c.geometry.coordinates[0] }));

/**
 * Circuito COM traçado real: sem contorno (desenha o traçado). Sem traçado: envoltória convexa das chaves carregadas, ROTULADA
 * "aproximado". Menos de 3 chaves distintas, ou todas alinhadas, devolve só pontos (sem polígono).
 */
export function contornoDoCircuito(temTracado: boolean, chaves: readonly FeicaoChave[] | undefined): Contorno | null {
  if (temTracado || !chaves || chaves.length === 0) return null;
  return contornoAproximado(pontosDasChaves(chaves));
}

export const ROTULO_CONTORNO_APROXIMADO = "Contorno aproximado (envoltória das chaves)";

export function textoDoContorno(c: Contorno | null, qtdChaves: number): string | null {
  if (!c) return null;
  if (c.tipo === "poligono") return `${ROTULO_CONTORNO_APROXIMADO}: ${c.vertices.length} vértices a partir de ${qtdChaves.toLocaleString(PT)} chaves. Não é o traçado real.`;
  return "Menos de 3 chaves distintas (ou todas alinhadas): só os pontos, sem contorno.";
}

// ───────── Rede do circuito: o que a base tem ─────────
export interface DescricaoRede { tracado: boolean; chaves: number; mensagem: string }

export function descreverRede(i: Pick<CircuitoResumo, "tem_tracado" | "chaves_qtd">): DescricaoRede {
  const chaves = i.chaves_qtd ?? 0;
  if (i.tem_tracado) return { tracado: true, chaves, mensagem: "Traçado real da base, colorido por trecho." };
  if (chaves > 0) return { tracado: false, chaves, mensagem: "Sem traçado na base: o contorno é aproximado (envoltória das chaves), não é o traçado real." };
  return { tracado: false, chaves: 0, mensagem: "Sem traçado e sem chaves na base: aparecem só as OS e os transformadores com posição." };
}

// ───────── Transformadores no mapa ─────────
/** 950 → "950"; 1.234 → "1,2k"; 12.500 → "13k". Cabe dentro do círculo. */
export function rotuloCompacto(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "0";
  if (n < 1000) return String(Math.round(n));
  if (n < 10_000) return `${(n / 1000).toLocaleString(PT, { maximumFractionDigits: 1 })}k`;
  return `${Math.round(n / 1000).toLocaleString(PT)}k`;
}

export function textoDoTransformador(t: TransformadorRede): string {
  const c = (n: number) => n.toLocaleString(PT);
  return `Transformador ${t.transformador} · ${c(t.clientes)} clientes identificados (${c(t.ligados)} ligados)`;
}

// ───────── O que o mapa recebe do circuito selecionado ─────────
export interface CircuitoNoMapa {
  codigo: string;
  tracado: FeicaoLinha[];
  chaves: FeicaoChave[];
  transformadores: TransformadorRede[];
  /** nome do tipo de chave → cor (a legenda usa as mesmas) */
  coresChaves: Record<string, string>;
  contorno: Contorno | null;
  limites: Limites | null;
}

// ───────── Enquadramento ─────────
/** bbox do circuito (das chaves) se existir; senão o retângulo das OS, chaves e transformadores com posição. */
export function limitesDoCircuito(a: {
  bbox: CircuitoResumo["bbox"];
  os: readonly Pick<OSRedeLeve, "lat" | "lng">[];
  chaves: readonly FeicaoChave[];
  transformadores: readonly TransformadorRede[];
}): Limites | null {
  if (a.bbox) return [[a.bbox.min_lat, a.bbox.min_lng], [a.bbox.max_lat, a.bbox.max_lng]];
  const pts = [
    ...a.os.filter(temCoordenada),
    ...pontosDasChaves(a.chaves),
    ...a.transformadores.filter(temPosicao).map((t) => ({ lat: t.lat, lng: t.lng })),
  ];
  return limitesDasOS(pts);
}

