import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { analisarOSPendentes, type ResultadoImportacaoOS, type Tabela } from "@farol/shared";
import { auditar, pode } from "../auth.js";
import {
  garantirCidades, gravarLote, lerConfigImportacao, montarItens, numerosJaExistentes, planejarCidades,
} from "../services/importacao-os-pendente.js";

// Cadastro de OS por arquivo no formato "OS manutenção pendente". O navegador lê o CSV, projeta SÓ as colunas reconhecidas e envia a
// tabela enxuta; o servidor refaz toda a análise (nunca confia no cliente). Cria cidades (uma por município), então é do Administrador.
const Celula = z.union([z.string().max(500), z.number(), z.boolean(), z.null()]);
const TabelaSchema = z.object({
  cabecalho: z.array(z.string().max(200)).max(60),
  linhas: z.array(z.object({ linha: z.number().int().positive(), valores: z.array(Celula).max(60) })).max(20_000),
});
const Corpo = z.object({ tabela: TabelaSchema }).strict();

const LIMITE_REJEITADAS = 5000;
const LIMITE_AVISOS = 300;

/** Só quem pode cadastrar (`nova`) e vê todas as cidades (Administrador): a importação cria cidades. Negado = 403 + auditoria. */
async function exigirImportador(req: FastifyRequest, reply: FastifyReply, acao: string): Promise<boolean> {
  const a = req.ator!;
  if (!pode(a, "nova") || !a.todasCidades) {
    await auditar(a, `negado:${acao}`, { entidade: "os_pendentes", resultado: "negado" });
    reply.code(403).send({ erro: "Sem permissão" });
    return false;
  }
  return true;
}

const msg = (e: z.ZodError) => e.issues.map((i) => (i.path.length ? `${i.path.join(".")}: ` : "") + i.message).join(" ");

export async function rotasImportarOSPendentes(app: FastifyInstance) {
  // Prévia: não grava nada (nem cidades). Mostra o que entra, o que sai, os avisos e os vazios por coluna.
  app.post("/os/importar-pendentes/preview", { bodyLimit: 25 * 1024 * 1024 }, async (req, reply) => {
    if (!(await exigirImportador(req, reply, "importar_pendentes_preview"))) return;
    const corpo = Corpo.safeParse(req.body);
    if (!corpo.success) return reply.code(400).send({ erro: msg(corpo.error) });

    const conf = await lerConfigImportacao();
    if (!conf) return reply.code(500).send({ erro: "Configuração da importação indisponível." });
    const r: ResultadoImportacaoOS = analisarOSPendentes(corpo.data.tabela as Tabela, conf.cfg);
    if (r.erroEstrutural) return reply.code(400).send({ erro: r.erroEstrutural });

    const plano = await planejarCidades(r.entram.map((o) => o.municipio));
    const existentes = await numerosJaExistentes(r.entram.map((o) => o.numeroOrigem));
    if (!plano || !existentes) return reply.code(500).send({ erro: "Falha ao consultar o banco." });

    const municipios = new Set(r.entram.map((o) => o.municipio));
    await auditar(req.ator, "os.importar_pendentes_preview", {
      entidade: "os_pendentes", detalhe: { totalLinhas: r.totalLinhas, entram: r.entram.length, rejeitadas: r.rejeitadas.length, comAviso: r.comAviso },
    });
    return {
      totalLinhas: r.totalLinhas,
      entram: r.entram.length,
      entramLinhas: r.entram.map((o) => o.linha),
      rejeitadas: r.rejeitadas.slice(0, LIMITE_REJEITADAS),
      totalRejeitadas: r.rejeitadas.length,
      comAviso: r.comAviso,
      avisosPorCodigo: r.avisosPorCodigo,
      avisos: r.entram.flatMap((o) => o.avisos).slice(0, LIMITE_AVISOS),
      semCoordenada: r.semCoordenada,
      origemEndereco: r.origemEndereco,
      vazios: r.vazios,
      colunasReconhecidas: r.colunasReconhecidas,
      colunasAusentes: r.colunasAusentes,
      amostra: r.entram.slice(0, 10).map((o) => ({
        linha: o.linha, numeroOrigem: o.numeroOrigem, municipio: o.municipio, endereco: o.endereco, origemEndereco: o.origemEndereco,
        semCoordenada: o.semCoordenada, clientes: o.clientes, prazoOrigem: o.prazoOrigem, prioridadeLegada: o.prioridadeLegada,
      })),
      cidades: {
        municipios: municipios.size,
        novas: plano.novas.length,
        existentes: municipios.size - plano.novas.length,
        exemplosNovas: plano.novas.slice(0, 20).map((c) => ({ municipio: c.municipio_origem, codigo: c.id })),
      },
      jaExistentes: existentes.size,
      tamanhoLote: conf.tamanhoLote,
    };
  });

  // Confirma UM lote (no máximo `importacao.tamanho_lote` linhas): atômico e idempotente por numero_origem. O cliente chama lote a lote.
  app.post("/os/importar-pendentes/confirmar", { bodyLimit: 5 * 1024 * 1024 }, async (req, reply) => {
    if (!(await exigirImportador(req, reply, "importar_pendentes"))) return;
    const corpo = Corpo.safeParse(req.body);
    if (!corpo.success) return reply.code(400).send({ erro: msg(corpo.error) });

    const conf = await lerConfigImportacao();
    if (!conf) return reply.code(500).send({ erro: "Configuração da importação indisponível." });
    const { tabela } = corpo.data;
    if (tabela.linhas.length === 0) return reply.code(400).send({ erro: "Nenhuma linha no lote." });
    if (tabela.linhas.length > conf.tamanhoLote) {
      return reply.code(400).send({ erro: `Lote com ${tabela.linhas.length} linhas; o máximo é ${conf.tamanhoLote}.` });
    }

    const r = analisarOSPendentes(tabela as Tabela, conf.cfg);
    if (r.erroEstrutural) return reply.code(400).send({ erro: r.erroEstrutural });

    let criadas = 0, jaExistentes = 0, cidadesCriadas = 0;
    const porCodigo: Record<string, number> = {};
    if (r.entram.length > 0) {
      const cidades = await garantirCidades(r.entram.map((o) => o.municipio));
      if (!cidades) return reply.code(500).send({ erro: "Falha ao preparar as cidades." });
      cidadesCriadas = cidades.criadas;

      let itens;
      try { itens = await montarItens(r.entram, cidades.mapa, Date.now()); }
      catch (e) {
        req.log.error(e);
        return reply.code(503).send({ erro: (e as Error).message });
      }
      const g = await gravarLote(itens, req.ator!.id);
      if ("erro" in g) {
        req.log.error({ erro: g.erro }, "importar_os_pendentes falhou");
        return reply.code(500).send({ erro: "Falha ao gravar o lote. Nada deste lote foi gravado; pode reenviá-lo." });
      }
      const novas = new Set(g.linhas.filter((x) => x.os_criada).map((x) => x.os_numero_origem));
      criadas = novas.size;
      jaExistentes = g.linhas.length - criadas;
      for (const it of itens) if (novas.has(it.numero_origem)) porCodigo[String(it.resultado.codigo)] = (porCodigo[String(it.resultado.codigo)] ?? 0) + 1;
    }

    await auditar(req.ator, "os.importar_pendentes", {
      entidade: "os_pendentes",
      detalhe: { recebidas: tabela.linhas.length, criadas, jaExistentes, rejeitadas: r.rejeitadas.length, comAviso: r.comAviso, cidadesCriadas },
    });
    return {
      recebidas: tabela.linhas.length, criadas, jaExistentes, cidadesCriadas, comAviso: r.comAviso,
      rejeitadas: r.rejeitadas.map((x) => ({ linha: x.linha, motivo: x.motivo })),
      prioridadePorCodigo: porCodigo,
    };
  });
}
