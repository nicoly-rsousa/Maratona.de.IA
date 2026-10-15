import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { calcularPrioridade, fatosAutomaticos, ordenarFila, type Fatos, type ItemFila } from "@farol/shared";
import { auditar, exigir, veCidade } from "../auth.js";
import { versaoVigente, regrasAtivas } from "../config.js";
import { db } from "../db.js";

const NovaOS = z.object({
  cidade: z.string().min(2),
  endereco: z.string().min(3),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
  transformador: z.string().regex(/^\d{4,12}$/, "Transformador: 4 a 12 dígitos (texto)").optional(),
  uc: z.string().regex(/^\d{6,10}$/).optional(),
  tipo: z.enum(["Corretiva", "Preventiva"]).default("Corretiva"),
  prazoH: z.number().nullable().default(null),
  fatos: z.record(z.union([z.string(), z.array(z.string())])).default({}),
});

export async function rotasOS(app: FastifyInstance) {
  // Fila ordenada (§2). Filtro por cidade SEMPRE no servidor.
  app.get("/os/fila", async (req, reply) => {
    if (!(await exigir(req, reply, "consultar"))) return;
    const a = req.ator!;
    const { cidade = "*" } = req.query as { cidade?: string };

    let q = db.from("ordens_servico").select("*").not("status", "in", "(Concluída,Cancelada)");
    if (cidade === "*") {
      if (!a.todasCidades) return reply.code(403).send({ erro: "Sem permissão para todas as cidades" });
    } else {
      if (!veCidade(a, cidade)) { await auditar(a, "negado:fila", { cidade, resultado: "negado" }); return reply.code(403).send({ erro: "Fora do escopo" }); }
      q = q.eq("cidade_id", cidade);
    }
    const { data, error } = await q;
    if (error) return reply.code(500).send({ erro: error.message });

    const itens: ItemFila[] = (data ?? []).map((o) => ({
      num: o.numero, cidade: o.cidade_id, nivel: o.nivel, codigo: o.codigo, tipo: o.tipo, pontos: o.pontos,
      prazoMs: o.prazo_limite ? Date.parse(o.prazo_limite) : null, aberturaMs: Date.parse(o.aberta_em),
    }));
    const posicoes = new Map(ordenarFila(itens).map((i) => [i.num, i]));
    return (data ?? [])
      .map((o) => ({ ...o, posicao: posicoes.get(o.numero)!.posicao }))
      .sort((x, y) => x.cidade_id.localeCompare(y.cidade_id) || x.posicao - y.posicao);
  });

  // Nova OS: calcula prioridade e grava OS + resultado imutável.
  app.post("/os", async (req, reply) => {
    const body = NovaOS.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ erro: body.error.flatten() });
    const d = body.data;
    if (!(await exigir(req, reply, "nova", d.cidade))) return;

    const [{ id: versaoId, versao }, regras] = await Promise.all([versaoVigente(d.cidade), regrasAtivas()]);
    const agora = Date.now();
    const fatos: Fatos = { ...d.fatos, tipo: d.tipo, ...fatosAutomaticos({ aberturaMs: agora, prazoH: d.prazoH }, agora) };
    const r = calcularPrioridade(fatos, versao, regras);

    const { data: num, error: e1 } = await db.rpc("proximo_numero_os", { p_cidade: d.cidade });
    if (e1) return reply.code(500).send({ erro: e1.message });

    const semLocal = d.lat == null || d.lng == null;
    const { data: os, error: e2 } = await db.from("ordens_servico").insert({
      numero: num, cidade_id: d.cidade, endereco: d.endereco, lat: d.lat, lng: d.lng,
      transformador: d.transformador, uc: d.uc, tipo: d.tipo, fatos: d.fatos,
      prazo_limite: d.prazoH == null ? null : new Date(agora + d.prazoH * 3_600_000).toISOString(),
      status: semLocal ? "Em triagem" : "Aguardando despacho", // §14.7
      versao_pontuacao_id: versaoId, nivel: r.nivel, codigo: r.codigo, pontos: r.pontos,
    }).select().single();
    if (e2 || !os) return reply.code(500).send({ erro: e2?.message });

    await db.from("resultados_prioridade").insert({
      os_id: os.id, versao: r.versao, itens: r.itens, pontos: r.pontos, codigo_faixa: r.codigoFaixa,
      regras_aplicadas: r.regrasAplicadas, nivel: r.nivel, codigo: r.codigo,
      motivo_principal: r.motivoPrincipal, motivo_calculo: "Abertura",
    });
    await auditar(req.ator, "os.criar", { entidade: "os", id: os.id, cidade: d.cidade });
    return reply.code(201).send({ os, resultado: r });
  });
}
