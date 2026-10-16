export type StatusOS =
  | "Aberta" | "Em triagem" | "Aguardando despacho" | "Suspensa" | "Equipe designada"
  | "A caminho" | "Em execução" | "Aguardando recurso" | "Concluída" | "Cancelada";

/** Permissão que libera a transição (a matriz de perfis fica na API, §13). */
export type PermissaoTransicao = "status" | "cancelar" | "reabrir";

/**
 * Transições MANUAIS permitidas (§10). O backend recusa o resto com 409.
 * ESPELHA a tabela `transicoes_status` do banco (supabase/migrations/0004): status.test.ts compara as duas.
 */
const MANUAIS: Record<string, StatusOS[]> = {
  "Aberta": ["Em triagem", "Aguardando despacho", "Cancelada"],
  "Em triagem": ["Aguardando despacho", "Cancelada"],
  "Aguardando despacho": ["Suspensa", "Cancelada", "Em triagem"],
  "Suspensa": ["Aguardando despacho", "Cancelada"],
  "Em execução": ["Aguardando recurso"],
  "Aguardando recurso": ["Em execução"],
  "Concluída": ["Aguardando despacho"], // reabertura: só Supervisor, justificada
};

export const STATUS_ABERTOS = (s: StatusOS) => s !== "Concluída" && s !== "Cancelada";

export function transicaoManualPermitida(de: StatusOS, para: StatusOS): boolean {
  return (MANUAIS[de] ?? []).includes(para);
}

/** Destinos manuais a partir de um status (lista vazia = o ciclo do despacho conduz as demais). */
export const transicoesManuais = (de: string): StatusOS[] => [...(MANUAIS[de] ?? [])];

/** Todas as transições, para conferência com o banco. */
export const todasTransicoes = (): { de: string; para: StatusOS }[] =>
  Object.entries(MANUAIS).flatMap(([de, paras]) => paras.map((para) => ({ de, para })));

/** Reabrir (Concluída → …) só com permissão própria; cancelar com `cancelar`; o resto com `status`. */
export function permissaoDaTransicao(de: string, para: StatusOS): PermissaoTransicao {
  if (para === "Cancelada") return "cancelar";
  if (de === "Concluída") return "reabrir";
  return "status";
}

/** Cancelar, suspender e reabrir exigem motivo/justificativa. */
export const exigeMotivo = (de: string, para: StatusOS) => para === "Cancelada" || para === "Suspensa" || de === "Concluída";
