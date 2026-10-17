import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  ConteudoSchema, DescartarSchema, ESCOPO_GLOBAL, EscopoSchema, PublicarSchema, SalvarRascunhoSchema, ValidarSchema,
  VersaoIdSchema, validarVersao, type RespostaPublicar, type RespostaValidar,
} from "@farol/shared";
import { auditar, pode, veCidade, type Permissao } from "../auth.js";
import { configPontuacao } from "../config.js";
import { db, type Linha } from "../db.js";
import { mensagens } from "../http.js";
import { traduzirErroRpc } from "../services/rpc.js";
import { cidadeDoEscopo, escopoDaLinha, escopoExiste, montarEstado } from "../services/pontuacao.js";

const EscopoQuery = z.object({ escopo: EscopoSchema });



/**
 * Permissão e escopo (§8, §13). Sem `escopo` só confere a permissão. Escopo de cidade: o usuário tem de ver a
 * cidade. Escopo global: só quem acessa todas as cidades (a versão global vale para todas). Falha → 403 + auditoria.
 */
async function liberar(req: FastifyRequest, reply: FastifyReply, perms: Permissao[], acao: string, escopo?: string): Promise<boolean> {
  const a = req.ator!;
  const cidade = escopo ? (cidadeDoEscopo(escopo) ?? undefined) : undefined;
  let erro: string | null = null;
  if (!perms.some((p) => pode(a, p))) erro = "Sem permissão";
  else if (escopo === ESCOPO_GLOBAL && !a.todasCidades) erro = "A pontuação global vale para todas as cidades: só quem acessa todas as cidades pode alterá-la.";
  else if (cidade && !veCidade(a, cidade)) erro = "Fora do escopo";
  if (!erro) return true;
  await auditar(a, `negado:pontuacao.${acao}`, { entidade: "pontuacao", id: escopo, cidade, resultado: "negado" });
  reply.code(403).send({ erro });
  return false;
}

/** Carrega a versão pelo id (404 se não existir). Devolve null se já respondeu. */
async function carregarVersao(reply: FastifyReply, id: string): Promise<Linha | null> {
  const { data, error } = await db.from("versoes_pontuacao").select("*").eq("id", id).maybeSingle();
  if (error) { reply.code(500).send({ erro: error.message }); return null; }
  if (!data) { reply.code(404).send({ erro: "Versão não encontrada" }); return null; }
  return data as Linha;
}

/** Chamada de uma função do banco (0005): erro conhecido → 400/403/404/409, com auditoria da recusa. */
async function chamar(
  req: FastifyRequest, reply: FastifyReply, acao: string, escopo: string, detalhe: Record<string, unknown>,
  chamada: PromiseLike<{ data: unknown; error: { code?: string; message: string; hint?: string | null } | null }>,
): Promise<Record<string, any> | null> { // eslint-disable-line @typescript-eslint/no-explicit-any -- jsonb devolvido pela função
  const { data, error } = await chamada;
  if (!error) return data as Record<string, unknown>;
  const t = traduzirErroRpc(error);
  if (t.status === 500) req.log.error(error);
  else await auditar(req.ator, `recusado:pontuacao.${acao}`, {
    entidade: "pontuacao", id: escopo, cidade: cidadeDoEscopo(escopo) ?? undefined, detalhe: { ...detalhe, erro: error.message }, resultado: String(t.status),
  });
  reply.code(t.status).send(t.corpo);
  return null;
}

const registrar = (req: FastifyRequest, acao: string, escopo: string, id: string | undefined, detalhe: Record<string, unknown>) =>
  auditar(req.ator, `pontuacao.${acao}`, { entidade: "versao_pontuacao", id, cidade: cidadeDoEscopo(escopo) ?? undefined, detalhe: { escopo, ...detalhe } });

export async function rotasPontuacao(app: FastifyInstance) {
  // Versões do escopo: publicada vigente, rascunho, aguardando aprovação e histórico.
  // Leitura também para quem só aprova (Supervisor); a edição exige `pontuacao`.
  app.get("/pontuacao/versoes", async (req, reply) => {
    const q = EscopoQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ erro: mensagens(q.error) });
    const { escopo } = q.data;
    if (!(await liberar(req, reply, ["pontuacao", "pontuacao_aprovar"], "ler", escopo))) return;
    if (!(await escopoExiste(escopo))) return reply.code(404).send({ erro: `Cidade "${escopo}" não encontrada.` });
    return montarEstado(escopo);
  });

  // Grava o ÚNICO rascunho do escopo. Etag antigo → 409 (outro usuário alterou).
  app.put("/pontuacao/rascunho", async (req, reply) => {
    const q = EscopoQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ erro: mensagens(q.error) });
    const body = SalvarRascunhoSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ erro: mensagens(body.error) });
    const { escopo } = q.data;
    if (!(await liberar(req, reply, ["pontuacao"], "salvar_rascunho", escopo))) return;

    const out = await chamar(req, reply, "salvar_rascunho", escopo, { etag: body.data.etag },
      db.rpc("salvar_rascunho", { p_escopo: escopo, p_conteudo: body.data.conteudo, p_etag: body.data.etag, p_usuario: req.ator!.id }));
    if (!out) return;
    await registrar(req, "salvar_rascunho", escopo, out.id, { numero: out.numero, etag: out.etag });
    return montarEstado(escopo);
  });

  // Valida SEM gravar: erros (bloqueiam) e alertas (não bloqueiam), com o máximo vindo do banco.
  app.post("/pontuacao/validar", async (req, reply) => {
    const q = EscopoQuery.safeParse(req.query);
    if (!q.success) return reply.code(400).send({ erro: mensagens(q.error) });
    const body = ValidarSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ erro: mensagens(body.error) });
    if (!(await liberar(req, reply, ["pontuacao"], "validar", q.data.escopo))) return;
    const { maxPontos } = await configPontuacao();
    const r: RespostaValidar = { ...validarVersao({ v: 0, ...body.data.conteudo }, maxPontos), maxPontos };
    return r;
  });

  // Publica o rascunho. Justificativa, vigência e modo (novas × reclassificar) são obrigatórios.
  app.post("/pontuacao/publicar", async (req, reply) => {
    const body = PublicarSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ erro: mensagens(body.error) });
    const d = body.data;
    if (!(await liberar(req, reply, ["pontuacao"], "publicar"))) return;
    const versao = await carregarVersao(reply, d.rascunhoId);
    if (!versao) return;
    const escopo = escopoDaLinha(versao);
    if (!(await liberar(req, reply, ["pontuacao"], "publicar", escopo))) return;

    // Erros e alertas completos para a tela; o banco repete os erros que bloqueiam (0005).
    if (versao.status === "rascunho") {
      const conteudo = ConteudoSchema.safeParse(versao.conteudo);
      if (!conteudo.success) return reply.code(400).send({ erro: `Rascunho inválido: ${mensagens(conteudo.error)}` });
      const { maxPontos } = await configPontuacao();
      const v = validarVersao({ v: versao.numero, ...conteudo.data }, maxPontos);
      if (v.erros.length) return reply.code(400).send({ erro: `A versão tem ${v.erros.length} erro(s) que bloqueiam a publicação.`, ...v });
    }

    const out = await chamar(req, reply, "publicar", escopo, { versao: versao.numero, modo: d.modo, vigenciaInicio: d.vigenciaInicio },
      db.rpc("publicar_versao", {
        p_rascunho: d.rascunhoId, p_justificativa: d.justificativa, p_vigencia_inicio: d.vigenciaInicio, p_modo: d.modo,
        p_usuario: req.ator!.id, p_etag: d.etag,
      }));
    if (!out) return;
    const aguardandoAprovacao = out.aguardando_aprovacao === true;
    await registrar(req, aguardandoAprovacao ? "enviar_aprovacao" : "publicar", escopo, out.id,
      { numero: out.numero, modo: d.modo, vigenciaInicio: d.vigenciaInicio, justificativa: d.justificativa });
    const r: RespostaPublicar = { ...(await montarEstado(escopo)), resultado: { numero: out.numero, aguardandoAprovacao } };
    return r;
  });

  // Aprova uma versão em "aguardando aprovação". Quem a enviou não pode aprovar (o banco recusa: 403).
  app.post("/pontuacao/aprovar", async (req, reply) => {
    const body = VersaoIdSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ erro: mensagens(body.error) });
    if (!(await liberar(req, reply, ["pontuacao_aprovar"], "aprovar"))) return;
    const versao = await carregarVersao(reply, body.data.versaoId);
    if (!versao) return;
    const escopo = escopoDaLinha(versao);
    if (!(await liberar(req, reply, ["pontuacao_aprovar"], "aprovar", escopo))) return;

    const out = await chamar(req, reply, "aprovar", escopo, { versao: versao.numero },
      db.rpc("aprovar_versao", { p_versao: body.data.versaoId, p_usuario: req.ator!.id }));
    if (!out) return;
    await registrar(req, "aprovar", escopo, out.id, { numero: out.numero });
    return montarEstado(escopo);
  });

  // Restaurar = NOVO rascunho a partir de uma versão publicada (a publicada nunca é editada).
  app.post("/pontuacao/restaurar", async (req, reply) => {
    const body = VersaoIdSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ erro: mensagens(body.error) });
    if (!(await liberar(req, reply, ["pontuacao"], "restaurar"))) return;
    const versao = await carregarVersao(reply, body.data.versaoId);
    if (!versao) return;
    const escopo = escopoDaLinha(versao);
    if (!(await liberar(req, reply, ["pontuacao"], "restaurar", escopo))) return;

    const out = await chamar(req, reply, "restaurar", escopo, { origem: versao.numero },
      db.rpc("restaurar_versao", { p_versao: body.data.versaoId, p_usuario: req.ator!.id }));
    if (!out) return;
    await registrar(req, "restaurar", escopo, out.id, { numero: out.numero, restauradaDe: out.restaurada_de });
    return montarEstado(escopo);
  });

  // Descarta o rascunho (nunca uma versão publicada).
  app.post("/pontuacao/descartar", async (req, reply) => {
    const body = DescartarSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ erro: mensagens(body.error) });
    if (!(await liberar(req, reply, ["pontuacao"], "descartar"))) return;
    const versao = await carregarVersao(reply, body.data.rascunhoId);
    if (!versao) return;
    const escopo = escopoDaLinha(versao);
    if (!(await liberar(req, reply, ["pontuacao"], "descartar", escopo))) return;

    const out = await chamar(req, reply, "descartar", escopo, { versao: versao.numero },
      db.rpc("descartar_rascunho", { p_rascunho: body.data.rascunhoId, p_etag: body.data.etag, p_usuario: req.ator!.id }));
    if (!out) return;
    await registrar(req, "descartar", escopo, out.id, { numero: out.numero });
    return montarEstado(escopo);
  });
}
