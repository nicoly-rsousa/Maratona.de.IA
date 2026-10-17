/** Perfis de acesso (§13). A matriz de permissões de cada perfil fica na API (apps/api/src/auth.ts). */
export type Perfil = "Administrador" | "Atendente" | "Despachante" | "Supervisor" | "Equipe de campo" | "Usuário Chave";

/** Usuário autenticado, como a API o resolve a partir do token (perfil, cidades vinculadas, equipe). */
export interface Ator {
  id: string;
  nome: string;
  perfil: Perfil;
  todasCidades: boolean;
  cidades: string[];
  /** só o perfil Equipe de campo: a equipe cujas OS ele vê e atende */
  equipeId: string | null;
}
