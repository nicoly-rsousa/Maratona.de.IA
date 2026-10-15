import type {
  CodigoIdx, Criterio, Faixa, Fatos, ItemCalculo, Regra, ResultadoPrioridade, VersaoPontuacao,
} from "./types";
import { CODIGOS } from "./types";

const MIN = 60_000;

export interface DadosTempo {
  aberturaMs: number;
  /** horas até o prazo-limite; negativo = vencido; null = sem prazo */
  prazoH: number | null;
}

/** Fatos dependentes do tempo (recalculados pelo job a cada 60 s). */
export function fatosAutomaticos(t: DadosTempo, agoraMs: number): Fatos {
  const espMin = (agoraMs - t.aberturaMs) / MIN;
  const espera = espMin <= 60 ? "Até 1 h" : espMin <= 240 ? "1–4 h" : "> 4 h";
  const h = t.prazoH;
  const prazo = h == null ? "Sem prazo" : h < 24 ? "< 24 h ou vencido" : h <= 72 ? "24–72 h" : "> 72 h";
  return { espera, prazo };
}

export function faixaDe(faixas: Faixa[], pts: number): Faixa | undefined {
  return faixas.find((f) => pts >= f.de && (f.ate == null || pts <= f.ate));
}

function selecionadas(c: Criterio, fato: string | string[] | undefined): string[] {
  const v = fato == null ? [] : Array.isArray(fato) ? fato : [fato];
  const validas = v.filter((l) => c.opcoes.some((o) => o.label === l));
  if (validas.length) return validas;
  // Informação desconhecida NÃO é risco zero: cai na opção "desconhecida".
  const desc = c.opcoes.find((o) => o.desconhecida);
  return desc ? [desc.label] : [];
}

function pontuarCriterio(c: Criterio, fato: string | string[] | undefined): ItemCalculo {
  const labels = selecionadas(c, fato);
  const ops = labels.map((l) => c.opcoes.find((o) => o.label === l)!);
  const pts = ops.map((o) => o.pontos ?? 0);
  const total = pts.length === 0 ? 0 : c.agregacao === "max" ? Math.max(...pts) : pts.reduce((a, b) => a + b, 0);
  return {
    criterio: c.nome,
    opcoes: labels,
    pontos: total,
    requerConfirmacao: ops.some((o) => o.requerConfirmacao),
  };
}

function regraAplica(r: Regra, fatos: Fatos, versao: VersaoPontuacao): boolean {
  return r.cond.every(({ criterio, opcoes }) => {
    const c = versao.criterios.find((x) => x.id === criterio);
    if (!c) return false;
    return selecionadas(c, fatos[criterio]).some((l) => opcoes.includes(l));
  });
}

/** Núcleo puro e determinístico. Cada chamada gera um resultado imutável. */
export function calcularPrioridade(
  fatos: Fatos,
  versao: VersaoPontuacao,
  regras: Regra[],
): ResultadoPrioridade {
  const itens = versao.criterios.filter((c) => c.habilitado).map((c) => pontuarCriterio(c, fatos[c.id]));
  const pontos = itens.reduce((a, i) => a + i.pontos, 0);
  const faixa = faixaDe(versao.faixas, pontos);
  const codigoFaixa = (faixa?.cod ?? 4) as CodigoIdx;

  const aplicadas = regras.filter((r) => r.ativa && regraAplica(r, fatos, versao));
  const nivel = aplicadas.reduce((m, r) => Math.max(m, r.nivel), 0);
  const codigo = Math.min(codigoFaixa, ...aplicadas.map((r) => r.prioridadeMinima)) as CodigoIdx;

  let motivoPrincipal: string;
  const regraDecisiva = aplicadas
    .filter((r) => r.prioridadeMinima === codigo && codigo < codigoFaixa)
    .sort((a, b) => b.nivel - a.nivel)[0];
  if (regraDecisiva) {
    motivoPrincipal = `Regra de precedência: ${regraDecisiva.nome}`;
  } else {
    const topo = [...itens].sort((a, b) => b.pontos - a.pontos)[0];
    motivoPrincipal = topo && topo.pontos > 0 ? `Pontuação: ${topo.criterio}` : `Pontuação ${pontos} (${CODIGOS[codigo]})`;
  }

  return {
    versao: versao.v,
    itens,
    pontos,
    codigoFaixa,
    regrasAplicadas: aplicadas.map((r) => r.id),
    nivel,
    codigo,
    motivoPrincipal,
  };
}

/** Só grava novo resultado se código, pontos ou precedência mudarem (reclassificação automática). */
export function mudou(a: ResultadoPrioridade, b: ResultadoPrioridade): boolean {
  return a.codigo !== b.codigo || a.pontos !== b.pontos || a.nivel !== b.nivel;
}
