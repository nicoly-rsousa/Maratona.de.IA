import type { FastifyInstance } from "fastify";
import { exigir } from "../auth.js";
import { db } from "../db.js";

export async function rotasCidades(app: FastifyInstance) {
  // Cidades ativas dentro do escopo do usuário (filtro no servidor, §8).
  app.get("/cidades", async (req, reply) => {
    if (!(await exigir(req, reply, "consultar"))) return;
    const a = req.ator!;

    let q = db.from("cidades").select("id, nome").eq("ativa", true).order("nome");
    if (!a.todasCidades) {
      if (!a.cidades.length) return [];
      q = q.in("id", a.cidades);
    }
    const { data, error } = await q;
    if (error) return reply.code(500).send({ erro: error.message });
    return data ?? [];
  });
}
