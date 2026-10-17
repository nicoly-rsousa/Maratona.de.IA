import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { STATUS_OS, permissaoDaTransicao, recomendarEquipes } from "@farol/shared";
import { auditar, exigir, pode, veCidade } from "../auth.js";
import { db, type Linha } from "../db.js";
import { idValido, mensagens } from "../http.js";
import { equipesCandidatas } from "../services/despacho.js";
import { traduzirErroRpc } from "../services/rpc.js";

const StatusBody = z.object({ para: z.enum(STATUS_OS), motivo: z.string().trim().max(1000).optional() });
const DesignarBody = z.object({
  equipe: z.string().min(1).max(40),
  apoio: z.boolean().default(false),
  excecao: z.boolean().default(false),
  justificativa: z.string().trim().max(1000).optional(),
});
const RemoverBody = z.object({ motivo: z.string().trim().min(1, "Informe o motivo da remoção.").max(1000) });
const AvancarBody = z.object({ passo: z.enum(["aceite", "inicio", "conclusao"]) });



/** Carrega a OS e aplica 400/404/403 (escopo de cidade, com auditoria). Devolve null se já respondeu. */
async function carregarOS(req: FastifyRequest, reply: FastifyReply, acao: string): Promise<Linha | null> {
  const { id } = req.params as { id: string };
  if (!idValido(id)) { reply.code(400).send({ erro: "Id inválido" }); return null; }
  const { data: os, error } = await db.from("ordens_servico").select("*").eq("id", id).maybeSingle();
  if (error) { reply.code(500).send({ erro: error.message }); return null; }
  if (!os) { reply.code(404).send({ erro: "OS não encontrada" }); return null; }
  if (!veCidade(req.ator!, os.cidade_id)) {
    await auditar(req.ator, `negado:${acao}`, { entidade: "os", id, cidade: os.cidade_id, resultado: "negado" });
    reply.code(403).send({ erro: "Fora do escopo" });
    return null;
  }
  return os;
}

/** Resposta de uma função do banco: sucesso → 200; erro conhecido → 400/403/404/409, com auditoria da recusa. */
async function responderRpc(
  req: FastifyRequest, reply: FastifyReply, os: Linha, acao: string, detalhe: unknown,
  chamada: PromiseLike<{ data: unknown; error: { code?: string; message: string; hint?: string | null } | null }>,
  okStatus = 200,
) {
  const { data, error } = await chamada;
  if (error) {
    const t = traduzirErroRpc(error);
    if (t.status === 500) req.log.error(error);
    else await auditar(req.ator, `recusado:${acao}`, { entidade: "os", id: os.id, cidade: os.cidade_id, detalhe: { ...(detalhe as object), erro: error.message }, resultado: String(t.status) });
    return reply.code(t.status).send(t.corpo);
  }
  await auditar(req.ator, acao, { entidade: "os", id: os.id, cidade: os.cidade_id, detalhe });
  return reply.code(okStatus).send(data);
}

export async function rotasDespacho(app: FastifyInstance) {
  // Mudança MANUAL de status (§10). A permissão depende da transição; a tabela de transições está no banco.
  app.post("/os/:id/status", async (req, reply) => {
    const body = StatusBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ erro: mensagens(body.error) });
    const os = await carregarOS(req, reply, "os.status");
    if (!os) return;
    const { para, motivo } = body.data;
    // Transição inexistente: 409 vem do banco; a permissão só é exigida de quem tenta uma transição conhecida.
    if (!(await exigir(req, reply, permissaoDaTransicao(os.status, para), os.cidade_id))) return;
    return responderRpc(req, reply, os, "os.status", { de: os.status, para },
      db.rpc("mudar_status", { p_os: os.id, p_para: para, p_motivo: motivo ?? null, p_usuario: req.ator!.id }));
  });

  // Recomendação de equipes: compatibilidade e disponibilidade antes da distância (§9).
  // Por padrão só equipes do município; ?apoio=1 inclui as de outras cidades (apoio intermunicipal).
  app.get("/os/:id/equipes", async (req, reply) => {
    const os = await carregarOS(req, reply, "os.equipes");
    if (!os) return;
    if (!(await exigir(req, reply, "designar", os.cidade_id))) return;
    const apoio = (req.query as { apoio?: string }).apoio === "1";
    const cidades = apoio ? (await db.from("cidades").select("id").eq("ativa", true)).data?.map((c) => c.id as string) ?? [os.cidade_id] : [os.cidade_id];
    const equipes = await equipesCandidatas(cidades);
    return recomendarEquipes(
      { cidade: os.cidade_id, lat: os.lat, lng: os.lng, exigeQualificacao: os.exige_qualificacao },
      equipes, { incluirApoio: apoio },
    );
  });

  // Designar equipe. Incompatível só com exceção autorizada (perfil com `excecao`); capacidade nunca é ultrapassada.
  app.post("/os/:id/despacho", async (req, reply) => {
    const body = DesignarBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ erro: mensagens(body.error) });
    const os = await carregarOS(req, reply, "os.designar");
    if (!os) return;
    if (!(await exigir(req, reply, "designar", os.cidade_id))) return;
    const d = body.data;
    if (d.excecao && !pode(req.ator!, "excecao")) {
      await auditar(req.ator, "negado:excecao", { entidade: "os", id: os.id, cidade: os.cidade_id, resultado: "negado" });
      return reply.code(403).send({ erro: "Só quem tem permissão de exceção de despacho pode autorizá-la." });
    }
    return responderRpc(req, reply, os, "os.designar", { equipe: d.equipe, apoio: d.apoio, excecao: d.excecao },
      db.rpc("designar_equipe", {
        p_os: os.id, p_equipe: d.equipe, p_apoio: d.apoio, p_excecao: d.excecao, p_justificativa: d.justificativa ?? null, p_usuario: req.ator!.id,
      }), 201);
  });

  // Remover a equipe: preserva o despacho e devolve a OS à fila.
  app.post("/os/:id/despacho/remover", async (req, reply) => {
    const body = RemoverBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ erro: mensagens(body.error) });
    const os = await carregarOS(req, reply, "os.remover_equipe");
    if (!os) return;
    if (!(await exigir(req, reply, "designar", os.cidade_id))) return;
    return responderRpc(req, reply, os, "os.remover_equipe", { motivo: body.data.motivo },
      db.rpc("remover_equipe", { p_os: os.id, p_motivo: body.data.motivo, p_usuario: req.ator!.id }));
  });

  // Aceite, início e conclusão. Equipe de campo: só da própria equipe (checado dentro da transação).
  app.post("/os/:id/despacho/avancar", async (req, reply) => {
    const body = AvancarBody.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ erro: mensagens(body.error) });
    const os = await carregarOS(req, reply, "os.avancar");
    if (!os) return;
    const a = req.ator!;
    let equipeExigida: string | null = null;
    if (pode(a, "designar")) {
      if (!(await exigir(req, reply, "designar", os.cidade_id))) return;
    } else {
      if (!(await exigir(req, reply, "campo", os.cidade_id))) return;
      if (!a.equipeId) {
        await auditar(a, "negado:campo.sem_equipe", { entidade: "os", id: os.id, cidade: os.cidade_id, resultado: "negado" });
        return reply.code(403).send({ erro: "Seu usuário não está vinculado a uma equipe." });
      }
      equipeExigida = a.equipeId;
    }
    return responderRpc(req, reply, os, `os.${body.data.passo}`, { passo: body.data.passo },
      db.rpc("avancar_despacho", { p_os: os.id, p_passo: body.data.passo, p_usuario: a.id, p_equipe_exigida: equipeExigida }));
  });
}
