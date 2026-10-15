export type StatusOS =
  | "Aberta" | "Em triagem" | "Aguardando despacho" | "Suspensa" | "Equipe designada"
  | "A caminho" | "Em execução" | "Aguardando recurso" | "Concluída" | "Cancelada";

/** Transições MANUAIS permitidas (§10). O backend recusa o resto com 409. */
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
export const exigeMotivo = (para: StatusOS) => para === "Cancelada";
