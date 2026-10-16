/** Formatos devolvidos pela API (apps/api). O detalhe da OS usa DetalheOS de @farol/shared. */

export type Perfil = "Administrador" | "Atendente" | "Despachante" | "Supervisor" | "Equipe de campo" | "Usuário Chave";

export interface Ator {
  id: string;
  nome: string;
  perfil: Perfil;
  todasCidades: boolean;
  cidades: string[];
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
