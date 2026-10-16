import type { ImpactoRegras } from "./regras-edicao";

/** Regra de precedência (camada A) como a API a entrega (consulta e edição). */
export interface CondicaoRegra {
  criterio: string;
  /** nome do critério na versão de pontuação vigente (o id se ela não o tiver) */
  criterioNome: string;
  opcoes: string[];
}

export interface RegraResumo {
  id: string;
  nome: string;
  ativa: boolean;
  condicoes: CondicaoRegra[];
  nivel: number;
  /** índice do código (0 = Emergente … 4 = Baixa): a regra garante, no mínimo, esta prioridade */
  prioridadeMinima: number;
  /** versão do conjunto em que esta regra foi alterada pela última vez */
  versao: number;
  atualizadoEm: string;
}

/** Uma versão do conjunto de regras (imutável; cada gravação cria a próxima). */
export interface VersaoRegrasResumo {
  numero: number;
  justificativa: string;
  criadoEm: string;
  autor: string | null;
  /** quantas regras o snapshot tem */
  quantidade: number;
  /** é o conjunto em vigor */
  vigente: boolean;
}

/** Critério da versão de pontuação vigente, para o editor oferecer só o que existe (nunca uma lista fixa no front). */
export interface CriterioParaRegra {
  id: string;
  nome: string;
  habilitado: boolean;
  opcoes: string[];
}

/** GET /regras */
export interface RespostaRegras {
  regras: RegraResumo[];
  /** número da versão do conjunto em vigor: volta em PUT /regras como `versaoBase` */
  versao: number;
  /** o usuário pode editar (Administrador) */
  editavel: boolean;
  /** da mais nova à mais antiga */
  versoes: VersaoRegrasResumo[];
  /** critérios e opções da versão de pontuação global vigente (vazio se não houver) */
  criterios: CriterioParaRegra[];
  versaoPontuacao: number | null;
}

/** POST /regras/prever: o impacto só vem quando não há erros. */
export interface RespostaPrever {
  erros: string[];
  alertas: string[];
  impacto: ImpactoRegras | null;
}

/** PUT /regras */
export interface RespostaSalvarRegras extends RespostaRegras {
  alertas: string[];
}

/** "Serviço essencial ∈ Hospital / emergência E Fonte de reserva ∈ Não/Desconhecida" (E lógico de condições). */
export function textoCondicoes(c: readonly CondicaoRegra[]): string {
  return c.map((x) => `${x.criterioNome} ∈ ${x.opcoes.join("/")}`).join(" E ");
}
