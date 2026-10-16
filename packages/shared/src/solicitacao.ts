import { z } from "zod";
import type { Fatos, VersaoPontuacao } from "./types";

/** Espelha o enum `tipo_manut` do banco (estrutural, não é regra de negócio). */
export const TIPOS_MANUTENCAO = ["Corretiva", "Preventiva"] as const;
export type TipoManutencao = (typeof TIPOS_MANUTENCAO)[number];

/**
 * Critérios que o atendente NÃO preenche: "tipo" vem do campo Tipo; "espera" e "prazo" são
 * calculados pelo motor (fatosAutomaticos). Todos os demais vêm da versão de pontuação publicada.
 */
export const CRITERIOS_NAO_PREENCHIVEIS: readonly string[] = ["tipo", "espera", "prazo"];

export interface OpcaoPergunta {
  label: string;
  desconhecida: boolean;
  requerConfirmacao: boolean;
}
export interface Pergunta {
  id: string;
  nome: string;
  opcoes: OpcaoPergunta[];
}

/** Perguntas do formulário, derivadas da versão publicada (sem expor pontos). */
export function perguntasDaVersao(v: VersaoPontuacao): Pergunta[] {
  return v.criterios
    .filter((c) => c.habilitado && !CRITERIOS_NAO_PREENCHIVEIS.includes(c.id))
    .map((c) => ({
      id: c.id,
      nome: c.nome,
      opcoes: c.opcoes.map((o) => ({ label: o.label, desconhecida: o.desconhecida, requerConfirmacao: o.requerConfirmacao })),
    }));
}

/** Valor inicial: informação não informada vira a opção "desconhecida", nunca zero (§3). */
export function valorInicial(p: Pergunta): string {
  return p.opcoes.find((o) => o.desconhecida)?.label ?? "";
}

/** Erros de fatos que não existem na versão publicada (o motor os trataria como "desconhecido" em silêncio). */
export function validarFatos(fatos: Fatos, v: VersaoPontuacao): string[] {
  const erros: string[] = [];
  const perguntas = new Map(perguntasDaVersao(v).map((p) => [p.id, p]));
  for (const [id, valor] of Object.entries(fatos)) {
    const p = perguntas.get(id);
    if (!p) { erros.push(`Critério "${id}" não existe na versão de pontuação publicada.`); continue; }
    for (const l of valor == null ? [] : Array.isArray(valor) ? valor : [valor]) {
      if (!p.opcoes.some((o) => o.label === l)) erros.push(`"${p.nome}": opção "${l}" não existe.`);
    }
  }
  return erros;
}

/** Localização válida = latitude e longitude finitas e dentro do intervalo (§12). */
export function temLocalizacao(lat: number | null | undefined, lng: number | null | undefined): boolean {
  return (
    typeof lat === "number" && typeof lng === "number" &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180
  );
}

/** Nova OS nasce "Aguardando despacho", ou "Em triagem" quando falta localização (§14.7). */
export function statusInicial(lat: number | null | undefined, lng: number | null | undefined) {
  return temLocalizacao(lat, lng) ? ("Aguardando despacho" as const) : ("Em triagem" as const);
}

export const TRANSFORMADOR_RE = /^\d{4,12}$/;
export const UC_RE = /^\d{6,10}$/;

const opcional = <T extends z.ZodTypeAny>(s: T) => s.optional();

/** Corpo de POST /os (compartilhado por API, seed e formulário). */
export const NovaOSSchema = z
  .object({
    cidade: z.string().min(2),
    endereco: z.string().trim().min(3, "Informe o endereço."),
    lat: opcional(z.number().min(-90).max(90)),
    lng: opcional(z.number().min(-180).max(180)),
    transformador: opcional(z.string().regex(TRANSFORMADOR_RE, "Transformador: 4 a 12 dígitos (texto)")),
    uc: opcional(z.string().regex(UC_RE, "UC: 6 a 10 dígitos")),
    circuito: opcional(z.string().trim().min(1)),
    conjunto: opcional(z.string().trim().min(1)),
    /** qualificação exigida (valores vêm das equipes da cidade); ausente = nenhuma */
    exigeQualificacao: opcional(z.string().trim().min(1)),
    tipo: z.enum(TIPOS_MANUTENCAO).default("Corretiva"),
    prazoH: z.number().finite().nullable().default(null),
    fatos: z.record(z.union([z.string(), z.array(z.string())])).default({}),
  })
  .refine((d) => (d.lat == null) === (d.lng == null), {
    message: "Informe latitude e longitude juntas, ou nenhuma das duas.",
    path: ["lat"],
  });
export type NovaOS = z.infer<typeof NovaOSSchema>;

/** Corpo de POST /os/:id/solicitacoes: nova solicitação vinculada a uma OS existente (§11). */
export const VincularSchema = z
  .object({
    endereco: opcional(z.string().trim().min(3)),
    lat: opcional(z.number().min(-90).max(90)),
    lng: opcional(z.number().min(-180).max(180)),
    transformador: opcional(z.string().regex(TRANSFORMADOR_RE, "Transformador: 4 a 12 dígitos (texto)")),
    uc: opcional(z.string().regex(UC_RE, "UC: 6 a 10 dígitos")),
    observacao: opcional(z.string().trim().min(1).max(500)),
    fatos: z.record(z.union([z.string(), z.array(z.string())])).default({}),
  })
  .refine((d) => (d.lat == null) === (d.lng == null), {
    message: "Informe latitude e longitude juntas, ou nenhuma das duas.",
    path: ["lat"],
  });
export type Vincular = z.infer<typeof VincularSchema>;

/** Resumo de uma solicitação para o detalhe da OS. */
export interface SolicitacaoResumo {
  id: string;
  origem: "abertura" | "vinculada";
  criadoEm: string;
  endereco: string | null;
  observacao: string | null;
}
