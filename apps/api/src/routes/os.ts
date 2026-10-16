import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  NovaOSSchema, TIPOS_MANUTENCAO, montarHistorico, ordenarFila, perguntasDaVersao, sugerirDuplicidade,
  type CandidataDuplicidade, type DetalheOS, type ItemFila, type LinhaResultado,
} from "@farol/shared";
import { auditar, exigir, veCidade } from "../auth.js";
import { versaoVigente } from "../config.js";
import { db } from "../db.js";
import { env } from "../env.js";
import { ErroDeEntrada, criarOS } from "../services/os.js";

/** Texto único para o front (o corpo `erro` é sempre string). */
const mensagens = (e: z.ZodError) => e.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ` : "") + i.message).join(" ");

// Query string: "" vira ausente; números chegam como texto.
const txt = z.string().trim().transform((s) => (s === "" ? undefined : s)).optional();
const num = z.string().trim().transform((s) => (s === "" ? undefined : Number(s))).pipe(z.number().finite().optional()).optional();
const ConsultaDup = z.object({
  cidade: z.string().min(2), endereco: txt, lat: num, lng: num, transformador: txt, uc: txt, conjunto: txt,
  tipo: z.enum(TIPOS_MANUTENCAO).optional(),
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

  // Detalhe da OS: último resultado + histórico de recálculos ("por que esta prioridade").
  app.get("/os/:id", async (req, reply) => {
    if (!(await exigir(req, reply, "consultar"))) return;
    const a = req.ator!;
    const { id } = req.params as { id: string };
    if (!z.string().uuid().safeParse(id).success) return reply.code(400).send({ erro: "Id inválido" });

    const { data: os, error } = await db.from("ordens_servico").select("*").eq("id", id).maybeSingle();
    if (error) return reply.code(500).send({ erro: error.message });
    if (!os) return reply.code(404).send({ erro: "OS não encontrada" });
    if (!veCidade(a, os.cidade_id)) {
      await auditar(a, "negado:os.detalhe", { entidade: "os", id, cidade: os.cidade_id, resultado: "negado" });
      return reply.code(403).send({ erro: "Fora do escopo" });
    }

    const [{ data: linhas, error: e2 }, { data: regras }, { data: abertas }] = await Promise.all([
      db.from("resultados_prioridade").select("*").eq("os_id", id),
      db.from("regras_precedencia").select("id, nome"),
      db.from("ordens_servico").select("*").eq("cidade_id", os.cidade_id).not("status", "in", "(Concluída,Cancelada)"),
    ]);
    if (e2) return reply.code(500).send({ erro: e2.message });

    const nomes = new Map((regras ?? []).map((r) => [r.id as string, r.nome as string]));
    const itens: ItemFila[] = (abertas ?? []).map((o) => ({
      num: o.numero, cidade: o.cidade_id, nivel: o.nivel, codigo: o.codigo, tipo: o.tipo, pontos: o.pontos,
      prazoMs: o.prazo_limite ? Date.parse(o.prazo_limite) : null, aberturaMs: Date.parse(o.aberta_em),
    }));
    const posicao = ordenarFila(itens).find((i) => i.num === os.numero)?.posicao ?? null;

    const detalhe: DetalheOS = {
      os: {
        id: os.id, numero: os.numero, cidade: os.cidade_id, endereco: os.endereco, lat: os.lat, lng: os.lng,
        transformador: os.transformador, uc: os.uc, tipo: os.tipo, status: os.status,
        prazoLimite: os.prazo_limite, abertaEm: os.aberta_em, posicao,
      },
      ...montarHistorico((linhas ?? []) as LinhaResultado[], nomes),
    };
    return detalhe;
  });

  // Apoio à tela "Nova solicitação": perguntas da versão de pontuação PUBLICADA e vigente na cidade (§5, §11).
  app.get("/os/criterios", async (req, reply) => {
    const { cidade } = (req.query ?? {}) as { cidade?: string };
    if (!cidade || cidade === "*") return reply.code(400).send({ erro: "Informe a cidade da solicitação." });
    if (!(await exigir(req, reply, "nova", cidade))) return;
    try {
      const { versao } = await versaoVigente(cidade);
      return { versao: versao.v, tipos: TIPOS_MANUTENCAO, perguntas: perguntasDaVersao(versao) };
    } catch (e) {
      return reply.code(503).send({ erro: (e as Error).message });
    }
  });

  // Sugestão de duplicidade (§11): nunca automática, sempre dentro da cidade informada e do escopo do usuário.
  app.get("/os/duplicidade", async (req, reply) => {
    const q = ConsultaDup.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ erro: mensagens(q.error) });
    const c = q.data;
    if (!(await exigir(req, reply, "nova", c.cidade))) return;

    const desde = new Date(Date.now() - env.DUP_JANELA_H * 3_600_000).toISOString();
    const { data, error } = await db
      .from("ordens_servico")
      .select("id, numero, cidade_id, endereco, status, codigo, tipo, lat, lng, transformador, uc, conjunto, aberta_em")
      .eq("cidade_id", c.cidade)
      .not("status", "in", "(Concluída,Cancelada)")
      .gte("aberta_em", desde)
      .limit(1000);
    if (error) return reply.code(500).send({ erro: error.message });

    const candidatas: CandidataDuplicidade[] = (data ?? []).map((o) => ({
      id: o.id, numero: o.numero, cidade: o.cidade_id, endereco: o.endereco, status: o.status, codigo: o.codigo, tipo: o.tipo,
      lat: o.lat, lng: o.lng, transformador: o.transformador, uc: o.uc, conjunto: o.conjunto, abertaEmMs: Date.parse(o.aberta_em),
    }));
    return sugerirDuplicidade({ ...c }, candidatas, Date.now(), { raioM: env.DUP_RAIO_M, janelaH: env.DUP_JANELA_H });
  });

  // Nova OS: calcula prioridade e grava OS + resultado imutável (mesmo caminho do seed:os).
  app.post("/os", async (req, reply) => {
    const body = NovaOSSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ erro: mensagens(body.error) });
    const d = body.data;
    if (!(await exigir(req, reply, "nova", d.cidade))) return;

    try {
      const { os, resultado } = await criarOS(d);
      await auditar(req.ator, "os.criar", { entidade: "os", id: os.id, cidade: d.cidade });
      return reply.code(201).send({ os, resultado });
    } catch (e) {
      if (e instanceof ErroDeEntrada) return reply.code(400).send({ erro: e.message });
      req.log.error(e);
      return reply.code(500).send({ erro: (e as Error).message });
    }
  });
}
