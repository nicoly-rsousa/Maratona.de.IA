import type { FastifyInstance } from "fastify";
import { versaoEfetiva, type RegraResumo, type RespostaRegras } from "@farol/shared";
import { auditar, pode } from "../auth.js";
import { carregarPublicadas } from "../config.js";
import { db } from "../db.js";

export async function rotasRegras(app: FastifyInstance) {
  // Regras de precedência (camada A) para CONSULTA. A edição é do administrador e ainda não existe.
  // As regras valem para todas as cidades: não há filtro de cidade. O Usuário Chave configura só a pontuação e não vê
  // a precedência (§13), mesmo tendo `consultar`.
  app.get("/regras", async (req, reply) => {
    const a = req.ator!;
    if (a.perfil === "Usuário Chave" || !(pode(a, "regras") || pode(a, "consultar"))) {
      await auditar(a, "negado:regras", { entidade: "regras", resultado: "negado" });
      return reply.code(403).send({ erro: "Sem permissão" });
    }

    const [{ data, error }, publicadas] = await Promise.all([
      db.from("regras_precedencia").select("*").order("nivel", { ascending: false }).order("id"),
      carregarPublicadas(),
    ]);
    if (error) return reply.code(500).send({ erro: error.message });

    // nomes dos critérios: da versão global vigente; sem ela (ou sem o critério), o próprio id
    const nomes = new Map((versaoEfetiva("", publicadas, Date.now())?.versao.criterios ?? []).map((c) => [c.id, c.nome]));
    const regras: RegraResumo[] = (data ?? []).map((r) => ({
      id: r.id, nome: r.nome, ativa: r.ativa, nivel: r.nivel, prioridadeMinima: r.prioridade_minima, versao: r.versao, atualizadoEm: r.atualizado_em,
      condicoes: ((r.cond ?? []) as { criterio: string; opcoes: string[] }[]).map((c) => ({
        criterio: c.criterio, criterioNome: nomes.get(c.criterio) ?? c.criterio, opcoes: c.opcoes,
      })),
    }));
    const resposta: RespostaRegras = { regras, editavel: false };
    return resposta;
  });
}
