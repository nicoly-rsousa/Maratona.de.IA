import type { ItemCalculo } from "./types";
import type { SolicitacaoResumo } from "./solicitacao";

/** Linha de `resultados_prioridade` como vem do banco (snake_case). */
export interface LinhaResultado {
  id: number;
  versao: number;
  itens: ItemCalculo[];
  pontos: number;
  codigo_faixa: number;
  regras_aplicadas: string[];
  nivel: number;
  codigo: number;
  motivo_principal: string;
  motivo_calculo: string;
  calculado_em: string;
}

export interface RegraAplicada {
  id: string;
  /** Nome vindo do cadastro; se a regra não existir mais, repete o id. */
  nome: string;
}

/** Resultado de um cálculo, pronto para o front (camelCase, regras com nome). */
export interface ResultadoDetalhe {
  id: number;
  versao: number;
  itens: ItemCalculo[];
  pontos: number;
  codigoFaixa: number;
  regrasAplicadas: RegraAplicada[];
  nivel: number;
  codigo: number;
  motivoPrincipal: string;
  motivoCalculo: string;
  calculadoEm: string;
}

export function montarResultado(l: LinhaResultado, nomesRegras: ReadonlyMap<string, string>): ResultadoDetalhe {
  return {
    id: l.id,
    versao: l.versao,
    itens: l.itens,
    pontos: l.pontos,
    codigoFaixa: l.codigo_faixa,
    regrasAplicadas: l.regras_aplicadas.map((id) => ({ id, nome: nomesRegras.get(id) ?? id })),
    nivel: l.nivel,
    codigo: l.codigo,
    motivoPrincipal: l.motivo_principal,
    motivoCalculo: l.motivo_calculo,
    calculadoEm: l.calculado_em,
  };
}

export interface DetalheOS {
  os: {
    id: string;
    numero: string;
    cidade: string;
    endereco: string;
    lat: number | null;
    lng: number | null;
    transformador: string | null;
    uc: string | null;
    tipo: "Corretiva" | "Preventiva";
    status: string;
    prazoLimite: string | null;
    abertaEm: string;
    exigeQualificacao: string | null;
    /** Posição na fila da cidade; null se a OS não está aberta. */
    posicao: number | null;
  };
  /** Cálculo mais recente (null só se a OS ainda não tiver resultado). */
  resultado: ResultadoDetalhe | null;
  /** Todos os cálculos, do mais recente ao mais antigo (inclui o atual). */
  historico: ResultadoDetalhe[];
  /** Solicitações recebidas para esta OS (abertura + vinculadas), da mais antiga à mais recente. */
  solicitacoes: SolicitacaoResumo[];
}

/** Ordena do mais recente ao mais antigo (empate: maior id) e separa o atual. */
export function montarHistorico(
  linhas: LinhaResultado[],
  nomesRegras: ReadonlyMap<string, string>,
): Pick<DetalheOS, "resultado" | "historico"> {
  const historico = [...linhas]
    .sort((a, b) => Date.parse(b.calculado_em) - Date.parse(a.calculado_em) || b.id - a.id)
    .map((l) => montarResultado(l, nomesRegras));
  return { resultado: historico[0] ?? null, historico };
}
