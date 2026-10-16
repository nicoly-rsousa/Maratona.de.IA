import { z } from "zod";
import { CriterioSchema, FaixaSchema } from "./types";

/** Escopo de uma versão: "global" ou o id da cidade (BH, CT…). */
export const ESCOPO_GLOBAL = "global";
export const EscopoSchema = z.string().regex(/^(global|[A-Z]{2,5})$/, 'Escopo inválido: use "global" ou o código da cidade.');

/** Conteúdo gravado em `versoes_pontuacao.conteudo` (o número da versão é uma coluna). */
export const ConteudoSchema = z
  .object({ criterios: z.array(CriterioSchema), faixas: z.array(FaixaSchema) })
  .superRefine((c, ctx) => {
    const ids = new Set<string>();
    c.criterios.forEach((k, i) => {
      if (ids.has(k.id)) ctx.addIssue({ code: "custom", path: ["criterios", i, "id"], message: `Critério repetido: "${k.id}".` });
      ids.add(k.id);
      const labels = new Set<string>();
      k.opcoes.forEach((o, j) => {
        if (labels.has(o.label)) ctx.addIssue({ code: "custom", path: ["criterios", i, "opcoes", j, "label"], message: `"${k.nome}": opção repetida "${o.label}".` });
        labels.add(o.label);
      });
    });
  });
export type ConteudoPontuacao = z.infer<typeof ConteudoSchema>;

export const SalvarRascunhoSchema = z.object({
  conteudo: ConteudoSchema,
  /** etag do rascunho que o cliente carregou; null = ainda não havia rascunho */
  etag: z.number().int().positive().nullable(),
});

export const ValidarSchema = z.object({ conteudo: ConteudoSchema });

export const PublicarSchema = z.object({
  rascunhoId: z.string().uuid(),
  etag: z.number().int().positive(),
  justificativa: z.string().trim().min(1, "Informe a justificativa."),
  vigenciaInicio: z.string().datetime({ offset: true, message: "Informe o início da vigência." }),
  modo: z.enum(["novas", "reclassificar"], {
    errorMap: () => ({ message: "Escolha se a versão vale só para novas OS ou reclassifica as OS abertas." }),
  }),
});

export const VersaoIdSchema = z.object({ versaoId: z.string().uuid() });
export const DescartarSchema = z.object({ rascunhoId: z.string().uuid(), etag: z.number().int().positive() });

export type StatusVersao = "rascunho" | "publicada" | "aguardando_aprovacao";

export interface VersaoResumo {
  id: string;
  numero: number;
  status: StatusVersao;
  etag: number;
  vigenciaInicio: string | null;
  modo: "novas" | "reclassificar" | null;
  justificativa: string | null;
  criadoEm: string;
  publicadoEm: string | null;
  atualizadoEm: string;
  /** quem publicou (ou enviou para aprovação) */
  autor: string | null;
  autorId: string | null;
  aprovadoPor: string | null;
  aprovadoEm: string | null;
  atualizadoPor: string | null;
  /** número da versão da qual este rascunho/versão foi restaurado */
  restauradaDe: number | null;
  /** é a versão em vigor neste escopo agora */
  vigente: boolean;
  /** publicada, mas a vigência ainda não chegou */
  agendada: boolean;
}

export type VersaoComConteudo = VersaoResumo & { conteudo: ConteudoPontuacao };

/** Resposta de POST /pontuacao/publicar: o estado do escopo mais o destino da versão. */
export interface RespostaPublicar extends EstadoPontuacao {
  resultado: { numero: number; aguardandoAprovacao: boolean };
}

/** POST /pontuacao/validar */
export interface RespostaValidar {
  erros: string[];
  alertas: string[];
  maxPontos: number;
}

/** GET /pontuacao/versoes e resposta de toda ação sobre o escopo. */
export interface EstadoPontuacao {
  escopo: string;
  maxPontos: number;
  exigirAprovacao: boolean;
  /** versão publicada vigente do próprio escopo */
  publicada: VersaoComConteudo | null;
  rascunho: VersaoComConteudo | null;
  aguardando: VersaoComConteudo | null;
  /** escopo de cidade sem versão própria vigente: a global que vale ali (base para o primeiro rascunho) */
  herdada: { numero: number; conteudo: ConteudoPontuacao } | null;
  /** publicadas e aguardando aprovação, da mais nova à mais antiga */
  historico: VersaoResumo[];
}
