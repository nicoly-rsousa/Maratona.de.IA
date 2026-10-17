import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  NovaOSSchema, TIPOS_MANUTENCAO, VincularSchema, montarHistorico, ordenarFila, perguntasDaVersao, processarImportacaoCsv, sugerirDuplicidade, validarFatos,
  type DetalheOS, type ItemFila, type LinhaResultado, type SolicitacaoResumo,
} from "@farol/shared";
import { auditar, exigir, veCidade } from "../auth.js";
import { carregarPublicadas, regrasEmVigor, versaoVigente } from "../config.js";
import { STATUS_FINAIS, db } from "../db.js";
import { idValido, mensagens } from "../http.js";
import { env } from "../env.js";
import { reclassificarOS } from "../jobs/reclassificar.js";
import { despachosDaOS, ehAtivo, eventosDaOS, osDaEquipe } from "../services/despacho.js";
import { ErroDeEntrada, candidatasAbertasDaCidade, criarOS, qualificacoesDaCidade } from "../services/os.js";


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

    let q = db.from("ordens_servico").select("*").not("status", "in", STATUS_FINAIS);
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
    // Equipe de campo vê só as OS da própria equipe; a posição continua sendo a da fila inteira da cidade.
    let visiveis = data ?? [];
    if (a.perfil === "Equipe de campo") {
      const minhas = new Set(a.equipeId ? await osDaEquipe(a.equipeId) : []);
      visiveis = visiveis.filter((o) => minhas.has(o.id));
    }
    return visiveis
      .map((o) => ({ ...o, posicao: posicoes.get(o.numero)!.posicao }))
      .sort((x, y) => x.cidade_id.localeCompare(y.cidade_id) || x.posicao - y.posicao);
  });

  // Detalhe da OS: último resultado + histórico de recálculos ("por que esta prioridade").
  app.get("/os/:id", async (req, reply) => {
    if (!(await exigir(req, reply, "consultar"))) return;
    const a = req.ator!;
    const { id } = req.params as { id: string };
    if (!idValido(id)) return reply.code(400).send({ erro: "Id inválido" });

    const { data: os, error } = await db.from("ordens_servico").select("*").eq("id", id).maybeSingle();
    if (error) return reply.code(500).send({ erro: error.message });
    if (!os) return reply.code(404).send({ erro: "OS não encontrada" });
    if (!veCidade(a, os.cidade_id)) {
      await auditar(a, "negado:os.detalhe", { entidade: "os", id, cidade: os.cidade_id, resultado: "negado" });
      return reply.code(403).send({ erro: "Fora do escopo" });
    }

    if (a.perfil === "Equipe de campo" && !(a.equipeId && (await osDaEquipe(a.equipeId)).includes(id))) {
      await auditar(a, "negado:os.detalhe", { entidade: "os", id, cidade: os.cidade_id, detalhe: { motivo: "OS de outra equipe" }, resultado: "negado" });
      return reply.code(403).send({ erro: "Esta OS não é da sua equipe" });
    }

    const [{ data: linhas, error: e2 }, { data: regras }, { data: abertas }, { data: sols, error: e3 }] = await Promise.all([
      db.from("resultados_prioridade").select("*").eq("os_id", id),
      db.from("regras_precedencia").select("id, nome"),
      db.from("ordens_servico").select("*").eq("cidade_id", os.cidade_id).not("status", "in", STATUS_FINAIS),
      db.from("solicitacoes").select("id, origem, criado_em, endereco, observacao").eq("os_id", id).order("criado_em", { ascending: true }),
    ]);
    if (e2 || e3) return reply.code(500).send({ erro: (e2 ?? e3)!.message });
    // O Usuário Chave configura a pontuação e não vê o despacho (§13): só os eventos de status seguem.
    const semDespacho = a.perfil === "Usuário Chave";
    const [despachos, todosEventos] = await Promise.all([semDespacho ? [] : despachosDaOS(id), eventosDaOS(id)]);
    const eventos = semDespacho ? todosEventos.filter((e) => e.tipo === "status") : todosEventos;
    const solicitacoes: SolicitacaoResumo[] = (sols ?? []).map((x) => ({
      id: x.id, origem: x.origem, criadoEm: x.criado_em, endereco: x.endereco, observacao: x.observacao,
    }));

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
        prazoLimite: os.prazo_limite, abertaEm: os.aberta_em, exigeQualificacao: os.exige_qualificacao, posicao,
      },
      ...montarHistorico((linhas ?? []) as LinhaResultado[], nomes),
      solicitacoes,
      despachos, despacho: despachos.find((d) => ehAtivo(d.estado)) ?? null, eventos,
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
      return {
        versao: versao.v, tipos: TIPOS_MANUTENCAO, perguntas: perguntasDaVersao(versao),
        qualificacoes: await qualificacoesDaCidade(cidade),
      };
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

<<<<<<< HEAD
    const desde = new Date(Date.now() - env.DUP_JANELA_H * 3_600_000).toISOString();
    const { data, error } = await db
      .from("ordens_servico")
      .select("id, numero, cidade_id, endereco, status, codigo, tipo, lat, lng, transformador, uc, conjunto, aberta_em")
      .eq("cidade_id", c.cidade)
      .not("status", "in", STATUS_FINAIS)
      .gte("aberta_em", desde)
      .limit(1000);
    if (error) return reply.code(500).send({ erro: error.message });
=======
    try {
      const candidatas = await candidatasAbertasDaCidade(c.cidade);
      return sugerirDuplicidade({ ...c }, candidatas, Date.now(), { raioM: env.DUP_RAIO_M, janelaH: env.DUP_JANELA_H });
    } catch (e) {
      return reply.code(500).send({ erro: (e as Error).message });
    }
  });
>>>>>>> 70f612613baaea41e96096aa9c5b0e731ed1826e

  // Importação de planilha (CSV) em "Nova solicitação": só prévia, nada é gravado (§11, duplicidade nunca é automática).
  app.post("/os/importar/preview", async (req, reply) => {
    const body = z.object({ cidade: z.string().min(2), csv: z.string().min(1, "Arquivo vazio.") }).safeParse(req.body);
    if (!body.success) return reply.code(400).send({ erro: mensagens(body.error) });
    const { cidade, csv } = body.data;
    if (!(await exigir(req, reply, "nova", cidade))) return;

    try {
      const candidatas = await candidatasAbertasDaCidade(cidade);
      const resultado = processarImportacaoCsv(csv, candidatas, Date.now(), { raioM: env.DUP_RAIO_M, janelaH: env.DUP_JANELA_H }, cidade);
      await auditar(req.ator, "os.importar_preview", { cidade, detalhe: { totalLinhas: resultado.totalLinhas, totalValidas: resultado.totalValidas, totalComErro: resultado.totalComErro } });
      return resultado;
    } catch (e) {
      req.log.error(e);
      return reply.code(500).send({ erro: (e as Error).message });
    }
  });

  // Confirma a importação: cria uma OS por linha escolhida pelo atendente (as que ele revisou e não pulou).
  app.post("/os/importar/confirmar", async (req, reply) => {
    const body = z
      .object({ cidade: z.string().min(2), itens: z.array(z.object({ linha: z.number().int().positive(), dados: NovaOSSchema })).min(1).max(500) })
      .safeParse(req.body);
    if (!body.success) return reply.code(400).send({ erro: mensagens(body.error) });
    const { cidade, itens } = body.data;
    if (!(await exigir(req, reply, "nova", cidade))) return;

    const criadas: { linha: number; numero: string; id: string }[] = [];
    const erros: { linha: number; mensagem: string }[] = [];
    for (const item of itens) {
      if (item.dados.cidade !== cidade) { erros.push({ linha: item.linha, mensagem: "Linha de outra cidade; não corresponde à cidade selecionada para a importação." }); continue; }
      try {
        const { os } = await criarOS(item.dados, { usuario: req.ator!.id });
        criadas.push({ linha: item.linha, numero: os.numero, id: os.id });
      } catch (e) {
        erros.push({ linha: item.linha, mensagem: e instanceof ErroDeEntrada ? e.message : (e as Error).message });
      }
    }
    await auditar(req.ator, "os.importar_confirmar", { cidade, detalhe: { total: itens.length, criadas: criadas.length, erros: erros.length } });
    return reply.code(criadas.length ? 201 : 200).send({ criadas, erros });
  });

  // Nova OS: calcula prioridade e grava OS + resultado imutável (mesmo caminho do seed:os).
  app.post("/os", async (req, reply) => {
    const body = NovaOSSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ erro: mensagens(body.error) });
    const d = body.data;
    if (!(await exigir(req, reply, "nova", d.cidade))) return;

    try {
      const { os, resultado } = await criarOS(d, { usuario: req.ator!.id });
      await auditar(req.ator, "os.criar", { entidade: "os", id: os.id, cidade: d.cidade });
      return reply.code(201).send({ os, resultado });
    } catch (e) {
      if (e instanceof ErroDeEntrada) return reply.code(400).send({ erro: e.message });
      req.log.error(e);
      return reply.code(500).send({ erro: (e as Error).message });
    }
  });

  // Vincula uma nova solicitação a uma OS existente (§11). Não cria OS; reclassifica a OS (§7).
  app.post("/os/:id/solicitacoes", async (req, reply) => {
    const { id } = req.params as { id: string };
    if (!idValido(id)) return reply.code(400).send({ erro: "Id inválido" });
    const body = VincularSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ erro: mensagens(body.error) });
    const d = body.data;

    const { data: os, error } = await db.from("ordens_servico").select("*").eq("id", id).maybeSingle();
    if (error) return reply.code(500).send({ erro: error.message });
    if (!os) return reply.code(404).send({ erro: "OS não encontrada" });
    if (!(await exigir(req, reply, "nova", os.cidade_id))) return;
    if (["Concluída", "Cancelada"].includes(os.status)) {
      return reply.code(409).send({ erro: `A OS ${os.numero} está ${os.status.toLowerCase()}; abra uma nova solicitação.` });
    }

    try {
      const { versao } = await versaoVigente(os.cidade_id);
      const invalidos = validarFatos(d.fatos, versao);
      if (invalidos.length) return reply.code(400).send({ erro: invalidos.join(" ") });

      const { data: sol, error: e1 } = await db.from("solicitacoes").insert({
        os_id: os.id, cidade_id: os.cidade_id, origem: "vinculada", endereco: d.endereco ?? null, lat: d.lat ?? null, lng: d.lng ?? null,
        transformador: d.transformador ?? null, uc: d.uc ?? null, fatos: d.fatos, observacao: d.observacao ?? null, criado_por: req.ator!.id,
      }).select("id").single();
      if (e1 || !sol) return reply.code(500).send({ erro: e1?.message ?? "Falha ao gravar a solicitação." });

      const em = await regrasEmVigor();
      const reclassificada = await reclassificarOS(os, em.regras, await carregarPublicadas(), Date.now(), "Solicitação vinculada", { regras: em });
      const { count } = await db.from("solicitacoes").select("id", { count: "exact", head: true }).eq("os_id", os.id);
      await auditar(req.ator, "os.vincular_solicitacao", { entidade: "os", id: os.id, cidade: os.cidade_id, detalhe: { solicitacao: sol.id } });
      return reply.code(201).send({ solicitacaoId: sol.id, numero: os.numero, total: count ?? null, reclassificada });
    } catch (e) {
      req.log.error(e);
      return reply.code(500).send({ erro: (e as Error).message });
    }
  });
}
