import { z } from "zod";

/** 0 = mais urgente. Mapeia COD no protótipo farol.html. */
export const CODIGOS = ["Emergente", "Urgente", "Alta", "Média", "Baixa"] as const;
export type CodigoIdx = 0 | 1 | 2 | 3 | 4;

export const OpcaoSchema = z.object({
  label: z.string().min(1),
  /** null = "sem pontos definidos" (diferente de 0) e IMPEDE a publicação. */
  pontos: z.number().int().nonnegative().nullable(),
  /** Opção "Desconhecida / Não informada": usada quando o fato não vem. */
  desconhecida: z.boolean().default(false),
  requerConfirmacao: z.boolean().default(false),
});
export type Opcao = z.infer<typeof OpcaoSchema>;

export const CriterioSchema = z.object({
  id: z.string().min(1),
  nome: z.string().min(1),
  habilitado: z.boolean().default(true),
  /** soma = condições de segurança; max = classes do cliente. */
  agregacao: z.enum(["soma", "max"]).default("soma"),
  opcoes: z.array(OpcaoSchema).min(1),
});
export type Criterio = z.infer<typeof CriterioSchema>;

export const FaixaSchema = z.object({
  de: z.number().int().nonnegative(),
  /** null = sem limite superior */
  ate: z.number().int().nonnegative().nullable(),
  cod: z.number().int().min(0).max(4),
});
export type Faixa = z.infer<typeof FaixaSchema>;

export const VersaoPontuacaoSchema = z.object({
  v: z.number().int().positive(),
  criterios: z.array(CriterioSchema),
  faixas: z.array(FaixaSchema),
});
export type VersaoPontuacao = z.infer<typeof VersaoPontuacaoSchema>;

export const RegraSchema = z.object({
  id: z.string(),
  nome: z.string(),
  ativa: z.boolean().default(true),
  /** E lógico de condições "critério ∈ opções" */
  cond: z.array(z.object({ criterio: z.string(), opcoes: z.array(z.string()).min(1) })).min(1),
  nivel: z.number().int().min(1).max(10),
  prioridadeMinima: z.number().int().min(0).max(4),
});
export type Regra = z.infer<typeof RegraSchema>;

/** Fatos da OS: valor único ou múltipla escolha. Ausente => opção "desconhecida". */
export type Fatos = Record<string, string | string[] | undefined>;

export interface ItemCalculo {
  criterio: string;
  opcoes: string[];
  pontos: number;
  requerConfirmacao: boolean;
}

export interface ResultadoPrioridade {
  versao: number;
  itens: ItemCalculo[];
  pontos: number;
  codigoFaixa: CodigoIdx;
  regrasAplicadas: string[];
  nivel: number;
  codigo: CodigoIdx;
  motivoPrincipal: string;
}
