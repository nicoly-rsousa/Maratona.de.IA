import { calcularPrioridade, fatosAutomaticos, mudou } from "./priority";
import type { Fatos, Regra, ResultadoPrioridade, VersaoPontuacao } from "./types";

/** Escolha feita na publicação (§5): obrigatória, sem valor padrão. */
export type ModoPublicacao = "novas" | "reclassificar";

/** Versão publicada, como a API a carrega do banco. */
export interface VersaoPublicada {
  id: string;
  /** null = global */
  cidadeId: string | null;
  numero: number;
  vigenciaInicioMs: number;
  modo: ModoPublicacao;
  /** conteúdo já validado; `v` = `numero` */
  versao: VersaoPontuacao;
}

const maisNova = (xs: VersaoPublicada[]) =>
  xs.reduce<VersaoPublicada | undefined>((a, b) => (!a || b.numero > a.numero ? b : a), undefined);

/**
 * Versão que vale para OS NOVAS na cidade (§5): a da cidade prevalece sobre a global; dentro do
 * escopo, a de maior número entre as que já entraram em vigência. A numeração é por escopo.
 */
export function versaoEfetiva(cidade: string, publicadas: VersaoPublicada[], agoraMs: number): VersaoPublicada | undefined {
  const vigentes = publicadas.filter((p) => p.vigenciaInicioMs <= agoraMs);
  return maisNova(vigentes.filter((p) => p.cidadeId === cidade)) ?? maisNova(vigentes.filter((p) => p.cidadeId === null));
}

export interface EscolhaVersao {
  versao: VersaoPublicada;
  /** o vínculo da OS muda (nova versão aplicada, ou OS que ainda não tinha vínculo) */
  migrou: boolean;
}

/**
 * Em que versão a OS é calculada (§5, §7). Cada OS FICA na versão com que foi calculada; só migra
 * quando `migrar` (a rotina das OS abertas, nunca um recálculo comum) e existe, no escopo que vale
 * na cidade, uma versão já em vigência publicada com "reclassificar abertas" e mais nova que a da OS.
 * Versões "somente novas OS" nunca alcançam OS existentes. Havendo várias, vale a mais nova que
 * reclassifica, de modo que o resultado não depende de quando a rotina rodou.
 * OS sem vínculo (ou com vínculo desconhecido) usa a versão vigente.
 */
export function escolherVersaoDaOS(
  os: { cidade: string; versaoId: string | null },
  publicadas: VersaoPublicada[],
  agoraMs: number,
  migrar: boolean,
): EscolhaVersao | undefined {
  const efetiva = versaoEfetiva(os.cidade, publicadas, agoraMs);
  const atual = os.versaoId ? publicadas.find((p) => p.id === os.versaoId) : undefined;
  if (!atual) return efetiva && { versao: efetiva, migrou: true };
  if (!migrar || !efetiva) return { versao: atual, migrou: false };

  const alvo = maisNova(
    publicadas.filter(
      (p) =>
        p.cidadeId === efetiva.cidadeId &&
        p.vigenciaInicioMs <= agoraMs &&
        p.modo === "reclassificar" &&
        (atual.cidadeId !== efetiva.cidadeId || p.numero > atual.numero),
    ),
  );
  return alvo && alvo.id !== atual.id ? { versao: alvo, migrou: true } : { versao: atual, migrou: false };
}

export interface OSParaCalculo {
  cidade: string;
  tipo: string;
  fatos: Fatos;
  abertaEmMs: number;
  prazoLimiteMs: number | null;
  /** OS importada do formato legado: sem prazo-limite do Farol, o prazo é DESCONHECIDO (não "Sem prazo") */
  prazoDesconhecido?: boolean;
  versaoId: string | null;
  /** cache atual da OS, para saber se algo mudou */
  anterior: { codigo: number; pontos: number; nivel: number };
  /** versão do conjunto de regras (camada A) com que a OS foi calculada pela última vez; ausente/null = nenhuma */
  regrasVersao?: number | null;
}

/** Versão do conjunto de regras com que `regras` foi carregado (regras_versoes). */
export interface VersaoRegrasEmVigor {
  numero: number;
  justificativa: string;
  /** a rotina: o motivo do cálculo vira "Regras vN: <justificativa>" quando a OS estava numa versão anterior */
  motivoDeRegras?: boolean;
}

export interface PlanoReclassificacao {
  versao: VersaoPublicada;
  migrou: boolean;
  resultado: ResultadoPrioridade;
  /** só grava resultado novo se o vínculo mudou ou código, pontos ou precedência mudaram (§7) */
  gravar: boolean;
  motivo: string;
  /** a OS estava numa versão anterior das regras (ou sem carimbo): o carimbo avança mesmo que não haja resultado novo */
  desatualizada: boolean;
  /** versão das regras a carimbar na OS; null quando o chamador não informou a versão */
  regrasVersao: number | null;
}

/**
 * Decisão pura da reclassificação de uma OS: versão usada (a da própria OS, salvo migração),
 * resultado e se há algo a gravar. O job só faz a leitura e a gravação em volta disto.
 */
export function planejarReclassificacao(
  os: OSParaCalculo,
  ctx: { publicadas: VersaoPublicada[]; regras: Regra[]; agoraMs: number; migrar: boolean; motivo: string; versaoRegras?: VersaoRegrasEmVigor },
): PlanoReclassificacao | undefined {
  const escolha = escolherVersaoDaOS({ cidade: os.cidade, versaoId: os.versaoId }, ctx.publicadas, ctx.agoraMs, ctx.migrar);
  if (!escolha) return undefined;

  const prazoH = os.prazoLimiteMs == null ? null : (os.prazoLimiteMs - ctx.agoraMs) / 3_600_000;
  const fatos: Fatos = { ...os.fatos, tipo: os.tipo, ...fatosAutomaticos({ aberturaMs: os.abertaEmMs, prazoH, prazoDesconhecido: os.prazoDesconhecido }, ctx.agoraMs) };
  const resultado = calcularPrioridade(fatos, escolha.versao.versao, ctx.regras);
  const alterou = mudou(os.anterior, resultado);

  // Regras novas (§4): OS numa versão anterior do conjunto é recalculada e recarimbada; só há resultado novo se algo mudou.
  const vr = ctx.versaoRegras;
  const desatualizada = !!vr && (os.regrasVersao ?? 0) < vr.numero;
  const motivoRegras = desatualizada && vr!.motivoDeRegras ? `Regras v${vr!.numero}: ${vr!.justificativa}` : null;
  const motivoPontuacao = os.versaoId ? `Nova versão v${escolha.versao.numero}` : `Vínculo à versão v${escolha.versao.numero}`;
  const motivo = !escolha.migrou ? (motivoRegras ?? ctx.motivo) : motivoRegras ? `${motivoPontuacao}; ${motivoRegras}` : motivoPontuacao;
  return {
    versao: escolha.versao, migrou: escolha.migrou, resultado, gravar: escolha.migrou || alterou, motivo,
    desatualizada, regrasVersao: vr?.numero ?? null,
  };
}
