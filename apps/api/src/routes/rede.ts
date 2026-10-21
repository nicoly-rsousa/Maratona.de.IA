import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { perfilVeRede, validarRaio } from "@farol/shared";
import { auditar } from "../auth.js";
import { db } from "../db.js";
import {
  AVISO_ORDEM, COLUNAS_OS, comCodigo, configRaio, dataDaImportacao, lerRegionais, lerTudo, mapaPrioridade, ordenarInformativo, perfisDaConfig,
  type OSRede,
} from "../services/rede.js";

const CHAVE_ACESSO = "rede.perfis_com_acesso";
const CHAVE_SUGERIR = "rede.perfis_sugerir_carona";

/** Regra de perfil da rede, aplicada AQUI: a API usa service_role e ignora a RLS. Sem cache; falha de leitura nega. */
async function exigirPerfis(req: FastifyRequest, reply: FastifyReply, chave: string, acao: string): Promise<boolean> {
  const a = req.ator!;
  const perfis = await perfisDaConfig(chave);
  if (!perfis || !perfilVeRede(a.perfil, perfis)) {
    await auditar(a, acao, { entidade: "rede", detalhe: { motivo: perfis ? "perfil_fora_da_lista" : "configuracao_indisponivel" }, resultado: "negado" });
    reply.code(403).send({ erro: "Sem permissão" });
    return false;
  }
  return true;
}
const exigirRede = (req: FastifyRequest, reply: FastifyReply) => exigirPerfis(req, reply, CHAVE_ACESSO, "negado:rede");

// Código de circuito pode ter espaço ("CET-LUM 2"): vai SEMPRE como valor vinculado (.eq / parâmetro de RPC), nunca em texto de consulta.
const Codigo = z.string().min(1).max(64);
const Numero = z.string().min(1).max(64);

const erro400 = (reply: FastifyReply, msg: string) => reply.code(400).send({ erro: msg });

async function buscarOS(numero: string): Promise<{ os: OSRede | null; falha: boolean }> {
  const { data, error } = await db.from("os_importadas").select(COLUNAS_OS).eq("numero", numero).maybeSingle();
  return { os: error ? null : ((data as OSRede | null) ?? null), falha: !!error };
}

async function circuitoExiste(codigo: string): Promise<boolean | null> {
  const { data, error } = await db.from("circuitos").select("codigo").eq("codigo", codigo).maybeSingle();
  return error ? null : !!data;
}

/** Chama a busca por raio no banco (PostGIS). Erro FD400 = raio inválido segundo o banco. */
async function osNoRaio(os: OSRede, raioM: number, regional: string | null) {
  return db.rpc("os_importadas_no_raio", { p_lat: os.lat, p_lng: os.lng, p_raio_m: raioM, p_excluir_circuito: os.circuito, p_regional: regional });
}

export async function rotasRede(app: FastifyInstance) {
  app.get("/rede/config", async (req, reply) => {
    if (!(await exigirRede(req, reply))) return;
    const cfg = await configRaio();
    if (!cfg) return reply.code(500).send({ erro: "Configuração de raio indisponível" });
    // Calculado no servidor; leitura que falha = não pode sugerir.
    const quem = await perfisDaConfig(CHAVE_SUGERIR);
    return { ...cfg, pode_sugerir: !!quem && perfilVeRede(req.ator!.perfil, quem) };
  });

  // Lista leve dos circuitos (busca no front). Desconhecido = null, nunca 0.
  app.get("/rede/circuitos", async (req, reply) => {
    if (!(await exigirRede(req, reply))) return;
    const cs = await lerTudo<Record<string, unknown>>((de, ate) => db.from("circuitos")
      .select("codigo, tem_tracado, clientes, ligados, desligados, chaves_qtd, bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng")
      .order("codigo").range(de, ate));
    const os = await lerTudo<{ numero: string; circuito: string | null }>((de, ate) =>
      db.from("os_importadas").select("numero, circuito").order("numero").range(de, ate));
    if (cs.falha || os.falha) return reply.code(500).send({ erro: "Falha ao consultar os alimentadores" });
    const qtd = new Map<string, number>();
    for (const o of os.linhas) if (o.circuito !== null) qtd.set(o.circuito, (qtd.get(o.circuito) ?? 0) + 1);
    const circuitos = cs.linhas.map((c) => {
      const completo = [c.bbox_min_lat, c.bbox_min_lng, c.bbox_max_lat, c.bbox_max_lng].every((v) => typeof v === "number");
      return {
        codigo: c.codigo, tem_tracado: c.tem_tracado, chaves_qtd: c.chaves_qtd ?? null,
        clientes_total: c.clientes ?? null, clientes_ligados: c.ligados ?? null, clientes_desligados: c.desligados ?? null,
        qtd_os: qtd.get(c.codigo as string) ?? 0,
        bbox: completo ? { min_lat: c.bbox_min_lat, min_lng: c.bbox_min_lng, max_lat: c.bbox_max_lat, max_lng: c.bbox_max_lng } : null,
      };
    });
    return { total: circuitos.length, circuitos };
  });

  // Municípios e regionais. Regional vazia = "não configurada": o front não filtra nem esconde nada.
  app.get("/rede/regionais", async (req, reply) => {
    if (!(await exigirRede(req, reply))) return;
    const r = await lerRegionais();
    if (r.falha) return reply.code(500).send({ erro: "Falha ao consultar as regionais" });
    const regionais = [...new Set(r.linhas.map((l) => l.regional).filter((x): x is string => !!x))].sort();
    return { configurada: r.configurada, regionais, municipios: r.linhas };
  });

  // Todas as OS importadas (campos leves, sem dado pessoal) para a visão geral do mapa.
  // ?circuito= filtra no banco; ?regional= só vale com a regional configurada (senão é ignorado e a resposta avisa).
  app.get("/rede/os", async (req, reply) => {
    if (!(await exigirRede(req, reply))) return;
    const q = req.query as { regional?: string; circuito?: string };
    const circuito = q.circuito === undefined || q.circuito === "" ? null : Codigo.safeParse(q.circuito);
    if (circuito && !circuito.success) return erro400(reply, "Código de alimentador inválido.");
    const regional = q.regional === undefined || q.regional.trim() === "" ? null : q.regional.trim();
    if (regional !== null && regional.length > 64) return erro400(reply, "Regional inválida.");

    const reg = await lerRegionais();
    if (reg.falha) return reply.code(500).send({ erro: "Falha ao consultar as regionais" });
    let municipios: Set<string> | null = null;
    if (regional !== null && reg.configurada) {
      municipios = new Set(reg.linhas.filter((l) => l.regional === regional).map((l) => l.municipio));
      if (municipios.size === 0) return erro400(reply, "Regional desconhecida.");
    }

    const lidas = await lerTudo<OSRede>((de, ate) => {
      let c = db.from("os_importadas").select(COLUNAS_OS).order("numero");
      if (circuito?.success) c = c.eq("circuito", circuito.data);
      return c.range(de, ate);
    });
    if (lidas.falha) return reply.code(500).send({ erro: "Falha ao consultar as OS" });
    const mapa = await mapaPrioridade();
    const os = lidas.linhas
      .filter((o) => !municipios || (o.municipio !== null && municipios.has(o.municipio)))
      .map((o) => {
        const c = comCodigo(o, mapa);
        return {
          numero: c.numero, circuito: c.circuito, circuito_origem: c.circuito_origem, lat: c.lat, lng: c.lng, municipio: c.municipio,
          prioridade_legada: c.prioridade_legada, prioridade_codigo: c.prioridade_codigo, prazo: c.prazo, tipo_servico: c.tipo_servico,
        };
      });
    return {
      importado_em: await dataDaImportacao(), total: os.length,
      filtro_regional: { configurada: reg.configurada, aplicado: municipios !== null },
      os,
    };
  });

  // Agregados do circuito + suas OS (ordem informativa).
  app.get("/rede/circuitos/:codigo", async (req, reply) => {
    if (!(await exigirRede(req, reply))) return;
    const p = Codigo.safeParse((req.params as { codigo?: string }).codigo);
    if (!p.success) return erro400(reply, "Código de alimentador inválido.");
    const { data: c, error } = await db.from("circuitos")
      .select("codigo, clientes, ligados, desligados, classes, chaves_qtd, tem_tracado, bbox_min_lat, bbox_min_lng, bbox_max_lat, bbox_max_lng")
      .eq("codigo", p.data).maybeSingle();
    if (error) return reply.code(500).send({ erro: "Falha ao consultar o alimentador" });
    if (!c) return reply.code(404).send({ erro: "Alimentador não encontrado" });
    const lidas = await lerTudo<OSRede>((de, ate) => db.from("os_importadas").select(COLUNAS_OS).eq("circuito", p.data).order("numero").range(de, ate));
    if (lidas.falha) return reply.code(500).send({ erro: "Falha ao consultar as OS" });
    const mapa = await mapaPrioridade();
    return {
      circuito: c,
      ordem_informativa: true, aviso_ordem: AVISO_ORDEM,
      os: ordenarInformativo(lidas.linhas.map((o) => comCodigo(o, mapa))),
    };
  });

  const geo = (sufixo: "tracado" | "chaves" | "transformadores") => async (req: FastifyRequest, reply: FastifyReply) => {
    if (!(await exigirRede(req, reply))) return;
    const p = Codigo.safeParse((req.params as { codigo?: string }).codigo);
    if (!p.success) return erro400(reply, "Código de alimentador inválido.");
    const existe = await circuitoExiste(p.data);
    if (existe === null) return reply.code(500).send({ erro: "Falha ao consultar o alimentador" });
    if (!existe) return reply.code(404).send({ erro: "Alimentador não encontrado" });
    const r = sufixo === "tracado"
      ? await db.rpc("rede_tracado_geojson", { p_circuito: p.data, p_incluir_bt: (req.query as { bt?: string }).bt === "1" })
      : sufixo === "chaves"
        ? await db.rpc("rede_chaves_geojson", { p_circuito: p.data })
        : await db.rpc("rede_transformadores_json", { p_circuito: p.data });
    if (r.error) return reply.code(500).send({ erro: "Falha ao consultar a rede" });
    return r.data;
  };
  app.get("/rede/circuitos/:codigo/tracado", geo("tracado"));
  app.get("/rede/circuitos/:codigo/chaves", geo("chaves"));
  app.get("/rede/circuitos/:codigo/transformadores", geo("transformadores"));

  // OS de OUTROS circuitos dentro do raio. Proximidade só gera sugestão: não mexe em prioridade nem fila.
  app.get("/rede/os/:numero/proximas", async (req, reply) => {
    if (!(await exigirRede(req, reply))) return;
    const n = Numero.safeParse((req.params as { numero?: string }).numero);
    if (!n.success) return erro400(reply, "Número de OS inválido.");
    const q = req.query as { raio_m?: string; regional?: string };
    let pedido: number | undefined;
    if (q.raio_m !== undefined && q.raio_m !== "") { pedido = Number(q.raio_m); if (!Number.isFinite(pedido)) return erro400(reply, "Raio inválido."); }
    const cfg = await configRaio();
    if (!cfg) return reply.code(500).send({ erro: "Configuração de raio indisponível" });
    const r = validarRaio(pedido, cfg);
    if (!r.ok) return erro400(reply, r.erro);

    const { os, falha } = await buscarOS(n.data);
    if (falha) return reply.code(500).send({ erro: "Falha ao consultar a OS" });
    if (!os) return reply.code(404).send({ erro: "OS não encontrada" });
    if (os.lat === null || os.lng === null) return reply.code(422).send({ erro: "OS sem coordenada: não é possível buscar por proximidade." });

    const { data, error } = await osNoRaio(os, r.raioM, q.regional?.trim() || null);
    if (error) return error.code === "FD400" ? erro400(reply, "Raio inválido.") : reply.code(500).send({ erro: "Falha na busca por raio" });
    const mapa = await mapaPrioridade();
    const lista = ((data ?? []) as (OSRede & { distancia_m: number })[]).filter((o) => o.numero !== os.numero).map((o) => comCodigo(o, mapa));
    // distância; empate → ordem informativa
    const ordem = new Map(ordenarInformativo(lista).map((o, i) => [o.numero, i]));
    lista.sort((a, b) => a.distancia_m - b.distancia_m || ordem.get(a.numero)! - ordem.get(b.numero)!);
    return { origem: os.numero, raio_m: r.raioM, ordem_informativa: true, aviso_ordem: AVISO_ORDEM, os: lista };
  });

  const Sugestao = z.object({ os_origem: Numero, os_sugerida: Numero, raio_m: z.number().finite() }).strict();

  // "Sugerir junto": só registra. Usuário vem do token; o servidor recalcula raio e circuito.
  app.post("/rede/sugestoes", async (req, reply) => {
    if (!(await exigirRede(req, reply))) return;
    if (!(await exigirPerfis(req, reply, CHAVE_SUGERIR, "negado:rede_sugestao"))) return;
    const a = req.ator!;
    const b = Sugestao.safeParse(req.body);
    if (!b.success) return erro400(reply, "Corpo inválido: informe os_origem, os_sugerida e raio_m.");
    const { os_origem, os_sugerida } = b.data;
    if (os_origem === os_sugerida) return erro400(reply, "Uma OS não pode sugerir a si mesma.");
    const cfg = await configRaio();
    if (!cfg) return reply.code(500).send({ erro: "Configuração de raio indisponível" });
    const r = validarRaio(b.data.raio_m, cfg);
    if (!r.ok) return erro400(reply, r.erro);

    const [o, s] = await Promise.all([buscarOS(os_origem), buscarOS(os_sugerida)]);
    if (o.falha || s.falha) return reply.code(500).send({ erro: "Falha ao consultar as OS" });
    if (!o.os || !s.os) return reply.code(404).send({ erro: "OS não encontrada" });
    if (o.os.lat === null || o.os.lng === null || s.os.lat === null || s.os.lng === null)
      return reply.code(422).send({ erro: "OS sem coordenada: não é possível validar a proximidade." });
    if (o.os.circuito !== null && o.os.circuito === s.os.circuito)
      return reply.code(422).send({ erro: "A OS sugerida precisa ser de outro alimentador." });

    // Recalcula no banco (PostGIS) se a sugerida está dentro do raio informado; o cliente não é confiável.
    const { data, error } = await osNoRaio(o.os, r.raioM, null);
    if (error) return error.code === "FD400" ? erro400(reply, "Raio inválido.") : reply.code(500).send({ erro: "Falha na busca por raio" });
    if (!((data ?? []) as { numero: string }[]).some((x) => x.numero === os_sugerida))
      return reply.code(422).send({ erro: "A OS sugerida está fora do raio informado." });

    const { data: ins, error: ei } = await db.from("sugestoes_rede")
      .insert({ os_origem, os_sugerida, raio_m: r.raioM, usuario: a.id }).select("id, os_origem, os_sugerida, raio_m, criado_em").single();
    if (ei) {
      if (ei.code === "23505") return reply.code(409).send({ erro: "Sugestão já registrada para este par de OS." });
      return reply.code(500).send({ erro: "Falha ao registrar a sugestão" });
    }
    await auditar(a, "rede:sugerir", { entidade: "sugestao_rede", id: String(ins.id), detalhe: { os_origem, os_sugerida, raio_m: r.raioM } });
    return reply.code(201).send(ins);
  });
}
