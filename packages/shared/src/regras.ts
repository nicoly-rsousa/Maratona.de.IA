/** Regra de precedência (camada A) como a API a entrega para consulta (somente leitura nesta etapa). */
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
  versao: number;
  atualizadoEm: string;
}

/** GET /regras */
export interface RespostaRegras {
  regras: RegraResumo[];
  /** a edição (administrador, com justificativa e versão) ainda não existe */
  editavel: false;
}

/** "Serviço essencial ∈ Hospital / emergência E Fonte de reserva ∈ Não/Desconhecida" (E lógico de condições). */
export function textoCondicoes(c: readonly CondicaoRegra[]): string {
  return c.map((x) => `${x.criterioNome} ∈ ${x.opcoes.join("/")}`).join(" E ");
}
