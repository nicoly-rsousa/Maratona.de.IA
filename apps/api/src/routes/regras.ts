import type { FastifyInstance } from "fastify";
import {
  PreverRegrasSchema, SalvarRegrasSchema, preverImpacto, validarRegras,
  type RespostaPrever, type RespostaSalvarRegras,
} from "@farol/shared";
import { auditar, exigir, pode } from "../auth.js";
import { carregarPublicadas, regrasAtivas } from "../config.js";
import { db } from "../db.js";
import { reclassificarAbertas } from "../jobs/reclassificar.js";
import { traduzirErroRpc } from "../services/despacho.js";
import { abertasParaImpacto, montarRespostaRegras, pontuacaoBase, versoesDeCidades } from "../services/regras.js";

const mensagens = (e: { issues: { path: (string | number)[]; message: string }[] }) =>
  e.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ` : "") + i.message).join(" ");

export async function rotasRegras(app: FastifyInstance) {
  // Regras de precedência (camada A): consulta para quem pode ver; edição só do Administrador (PUT abaixo).
  // As regras valem para todas as cidades: não há filtro de cidade. O Usuário Chave configura só a pontuação e a Equipe de
  // campo só atende as próprias OS: nenhum dos dois vê a precedência (§13), mesmo tendo `consultar`.
  app.get("/regras", async (req, reply) => {
    const a = req.ator!;
    if (a.perfil === "Usuário Chave" || a.perfil === "Equipe de campo" || !(pode(a, "regras") || pode(a, "consultar"))) {
      await auditar(a, "negado:regras", { entidade: "regras", resultado: "negado" });
      return reply.code(403).send({ erro: "Sem permissão" });
    }
    try {
      return await montarRespostaRegras(pode(a, "regras"), await carregarPublicadas());
    } catch (e) {
      req.log.error(e);
      return reply.code(500).send({ erro: (e as Error).message });
    }
  });

  // Pré-visualização: valida e mede o impacto nas OS abertas SEM gravar nada. A tela exige esta etapa antes de confirmar.
  app.post("/regras/prever", async (req, reply) => {
    if (!(await exigir(req, reply, "regras"))) return;
    const body = PreverRegrasSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ erro: mensagens(body.error) });
    try {
      const agora = Date.now();
      const publicadas = await carregarPublicadas();
      const base = pontuacaoBase(publicadas, agora);
      if (!base) return reply.code(409).send({ erro: "Não há versão de pontuação global vigente para validar as condições.", regra: "sem_versao_pontuacao" });

      const { erros, alertas } = validarRegras(body.data.regras, base.versao, versoesDeCidades(publicadas, agora));
      const impacto = erros.length
        ? null
        : preverImpacto(await abertasParaImpacto(), publicadas, await regrasAtivas(), body.data.regras, agora);
      const resposta: RespostaPrever = { erros, alertas, impacto };
      return resposta;
    } catch (e) {
      req.log.error(e);
      return reply.code(500).send({ erro: (e as Error).message });
    }
  });

  // Grava o conjunto INTEIRO como uma NOVA versão (regras_versoes, imutável). Justificativa obrigatória; versão base antiga → 409.
  // O banco repete as travas (administrador, justificativa, validação) em `salvar_regras`. As OS abertas são reclassificadas
  // pela rotina (e já disparamos uma volta aqui, sem esperar os 60 s).
  app.put("/regras", async (req, reply) => {
    if (!(await exigir(req, reply, "regras"))) return;
    const a = req.ator!;
    const body = SalvarRegrasSchema.safeParse(req.body);
    if (!body.success) return reply.code(400).send({ erro: mensagens(body.error) });
    const { regras, versaoBase, justificativa } = body.data;
    try {
      const agora = Date.now();
      const publicadas = await carregarPublicadas();
      const base = pontuacaoBase(publicadas, agora);
      if (!base) return reply.code(409).send({ erro: "Não há versão de pontuação global vigente para validar as condições.", regra: "sem_versao_pontuacao" });

      const { erros, alertas } = validarRegras(regras, base.versao, versoesDeCidades(publicadas, agora));
      if (erros.length) {
        await auditar(a, "recusado:regras.salvar", { entidade: "regras", detalhe: { versaoBase, erros }, resultado: "400" });
        return reply.code(400).send({ erro: erros.join(" "), regra: "validacao", erros, alertas });
      }

      const { data, error } = await db.rpc("salvar_regras", {
        p_conteudo: regras, p_justificativa: justificativa, p_usuario: a.id, p_versao_base: versaoBase,
      });
      if (error) {
        const t = traduzirErroRpc(error);
        if (t.status === 500) req.log.error(error);
        else await auditar(a, "recusado:regras.salvar", { entidade: "regras", detalhe: { versaoBase, erro: error.message }, resultado: String(t.status) });
        return reply.code(t.status).send(t.corpo);
      }

      const r = data as { numero: number; anterior: number; alteradas: number; removidas: number };
      await auditar(a, "regras.salvar", {
        entidade: "regras", id: String(r.numero), detalhe: { versao: r.numero, anterior: r.anterior, justificativa, alteradas: r.alteradas, removidas: r.removidas },
      });
      void reclassificarAbertas().catch((e) => req.log.error(e));

      const resposta: RespostaSalvarRegras = { ...(await montarRespostaRegras(true, await carregarPublicadas())), alertas };
      return resposta;
    } catch (e) {
      req.log.error(e);
      return reply.code(500).send({ erro: (e as Error).message });
    }
  });
}
