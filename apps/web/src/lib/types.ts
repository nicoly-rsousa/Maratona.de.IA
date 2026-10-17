import type { Ator as AtorBase, Pergunta, SugestaoDuplicidade } from "@farol/shared";

/** Formatos devolvidos pela API (apps/api). O detalhe da OS usa DetalheOS de @farol/shared. */

/** GET /me: o ator com as permissões do perfil. */
export interface Ator extends AtorBase {
  /** permissões do perfil (nova, consultar, status, …); a API continua sendo quem decide */
  permissoes: string[];
}

export interface Cidade {
  id: string;
  nome: string;
}

/** Linha de GET /os/fila (ordens_servico + posicao). */
export interface OSFila {
  id: string;
  numero: string;
  cidade_id: string;
  endereco: string;
  tipo: "Corretiva" | "Preventiva";
  status: string;
  nivel: number;
  codigo: number;
  pontos: number;
  prazo_limite: string | null;
  aberta_em: string;
  posicao: number;
}

/** GET /os/criterios?cidade= */
export interface CriteriosNova {
  versao: number;
  tipos: ("Corretiva" | "Preventiva")[];
  perguntas: Pergunta[];
  qualificacoes: string[];
}

/** Resposta de POST /os (apenas o que a tela usa). */
export interface OSCriada {
  os: { id: string; numero: string; status: string };
  resultado: { codigo: number; pontos: number; nivel: number; motivoPrincipal: string };
}

/** Resposta de POST /os/:id/solicitacoes */
export interface Vinculada {
  solicitacaoId: string;
  numero: string;
  total: number | null;
  reclassificada: boolean;
}

export type Sugestao = SugestaoDuplicidade;
