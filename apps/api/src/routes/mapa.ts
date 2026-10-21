import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { CIDADE_MAPA_RE, escopoDoMapa, type EquipeMapa, type OSMapa, type RespostaMapa } from "@farol/shared";
import { auditar, exigir } from "../auth.js";
import { db } from "../db.js";
import { env } from "../env.js";
import { equipesCandidatas, osDaEquipe } from "../services/despacho.js";

export async function rotasMapa(app: FastifyInstance) {
  // OS abertas e equipes ativas com posição, no escopo de cidade do usuário (§8). Sem dados pessoais:
  // nada de endereço, UC ou transformador. Equipe de campo recebe só as próprias OS e a própria equipe.
  app.get("/mapa", async (req, reply) => {
    if (!(await exigir(req, reply, "consultar"))) return;
    const a = req.ator!;
    const consulta = z.object({
      cidade: z.string().trim().min(2).optional(),
      alimentador: z.string().trim().min(1).max(64).optional(),
      sem_alimentador: z.enum(["true"]).optional(),
    }).refine((q) => !(q.alimentador && q.sem_alimentador), "Escolha um alimentador válido.").safeParse(req.query);
    if (!consulta.success) return reply.code(400).send({ erro: "Filtro de alimentador inválido." });
    const { cidade, alimentador, sem_alimentador } = consulta.data;
    if (!cidade || !CIDADE_MAPA_RE.test(cidade)) return reply.code(400).send({ erro: 'Informe a cidade (código, como BH) ou "*" para todas.' });

    const escopo = escopoDoMapa(cidade, a);
    if (!escopo.ok) {
      await auditar(a, "negado:mapa", {
        entidade: "mapa", cidade: cidade === "*" ? undefined : cidade, detalhe: { cidade, motivo: escopo.motivo }, resultado: "negado",
      });
      return reply.code(403).send({ erro: escopo.motivo === "todas_cidades" ? "Sem permissão para todas as cidades" : "Fora do escopo" });
    }

    let q = db.from("ordens_servico").select("id, numero, cidade_id, lat, lng, circuito, codigo, nivel, status, tipo").not("status", "in", "(Concluída,Cancelada)");
    if (cidade !== "*") q = q.eq("cidade_id", cidade);
    const { data, error } = await q;
    if (error) return reply.code(500).send({ erro: error.message });

    let linhas = data ?? [];
    const campo = a.perfil === "Equipe de campo";
    if (campo) {
      const minhas = new Set(a.equipeId ? await osDaEquipe(a.equipeId) : []);
      linhas = linhas.filter((o) => minhas.has(o.id));
    }
    if (alimentador) linhas = linhas.filter((o) => o.circuito === alimentador);
    if (sem_alimentador) linhas = linhas.filter((o) => o.circuito == null);
    const os: OSMapa[] = linhas.map((o) => ({
      id: o.id, num: o.numero, cidade: o.cidade_id, lat: o.lat, lng: o.lng, codigo: o.codigo, nivel: o.nivel, status: o.status, tipo: o.tipo,
    }));

    let cidades: string[];
    let centro: RespostaMapa["centro"] = null;
    if (cidade === "*") {
      const { data: cs, error: e2 } = await db.from("cidades").select("id").eq("ativa", true);
      if (e2) return reply.code(500).send({ erro: e2.message });
      cidades = (cs ?? []).map((c) => c.id as string);
    } else {
      cidades = [cidade];
      const { data: c, error: e2 } = await db.from("cidades").select("lat, lng").eq("id", cidade).maybeSingle();
      if (e2) return reply.code(500).send({ erro: e2.message });
      if (c?.lat != null && c?.lng != null) centro = { lat: c.lat, lng: c.lng };
    }

    let equipes: EquipeMapa[] = (await equipesCandidatas(cidades)).map((e) => ({
      id: e.id, cidade: e.cidade, lat: e.lat, lng: e.lng, capacidade: e.capacidade, emUso: e.carga,
    }));
    if (campo) equipes = equipes.filter((e) => e.id === a.equipeId);

    const r: RespostaMapa = { cidade, raioM: env.DUP_RAIO_M, centro, os, equipes };
    return r;
  });
}
