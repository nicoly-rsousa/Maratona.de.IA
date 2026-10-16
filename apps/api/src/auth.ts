import type { FastifyReply, FastifyRequest } from "fastify";
import { db } from "./db.js";

export type Perfil = "Administrador" | "Atendente" | "Despachante" | "Supervisor" | "Equipe de campo" | "Usuário Chave";
export type Permissao =
  | "nova" | "consultar" | "status" | "designar" | "cancelar" | "excecao" | "reabrir"
  | "pontuacao" | "regras" | "auditoria" | "campo";

/** Matriz de permissões (REGRADENEGOCIO §13). */
const BASE: Record<Perfil, Permissao[]> = {
  "Administrador": ["nova", "consultar", "status", "designar", "cancelar", "excecao", "reabrir", "pontuacao", "regras", "auditoria", "campo"],
  "Atendente": ["nova", "consultar"],
  "Despachante": ["consultar", "status", "designar", "cancelar"],
  "Supervisor": ["consultar", "status", "designar", "cancelar", "excecao", "reabrir", "auditoria"],
  "Equipe de campo": ["consultar", "campo"],
  "Usuário Chave": ["consultar", "pontuacao"],
};

export interface Ator {
  id: string;
  nome: string;
  perfil: Perfil;
  todasCidades: boolean;
  cidades: string[];
  /** só o perfil Equipe de campo: a equipe cujas OS ele vê e atende */
  equipeId: string | null;
}

declare module "fastify" {
  interface FastifyRequest { ator?: Ator }
}

export const permissoesDe = (p: Perfil): Permissao[] => [...BASE[p]];
export const pode =(a: Ator, p: Permissao) => BASE[a.perfil].includes(p);
export const veCidade = (a: Ator, cidade: string) => a.todasCidades || a.perfil === "Administrador" || a.cidades.includes(cidade);

export async function autenticar(req: FastifyRequest, reply: FastifyReply) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  if (!token) return reply.code(401).send({ erro: "Não autenticado" });

  const { data: u, error } = await db.auth.getUser(token);
  if (error || !u.user) return reply.code(401).send({ erro: "Sessão inválida" });

  const { data: p } = await db.from("perfis").select("nome, perfil, todas_cidades, equipe_id").eq("user_id", u.user.id).single();
  if (!p) return reply.code(403).send({ erro: "Usuário sem perfil" });
  const { data: cs } = await db.from("usuario_cidades").select("cidade_id").eq("user_id", u.user.id);

  req.ator = {
    id: u.user.id, nome: p.nome, perfil: p.perfil as Perfil,
    todasCidades: p.todas_cidades || p.perfil === "Administrador",
    cidades: (cs ?? []).map((c) => c.cidade_id as string),
    equipeId: (p.equipe_id as string | null) ?? null,
  };
}

export async function auditar(a: Ator | undefined, acao: string, extra: { entidade?: string; id?: string; cidade?: string; detalhe?: unknown; resultado?: string } = {}) {
  await db.from("auditoria").insert({
    usuario: a?.id, acao, entidade: extra.entidade, entidade_id: extra.id,
    cidade_id: extra.cidade, detalhe: extra.detalhe, resultado: extra.resultado ?? "ok",
  });
}

/** Acesso fora do escopo → 403 + auditoria (§8). */
export async function exigir(req: FastifyRequest, reply: FastifyReply, perm: Permissao, cidade?: string): Promise<boolean> {
  const a = req.ator!;
  if (!pode(a, perm) || (cidade && !veCidade(a, cidade))) {
    await auditar(a, `negado:${perm}`, { cidade, resultado: "negado" });
    reply.code(403).send({ erro: "Sem permissão" });
    return false;
  }
  return true;
}
