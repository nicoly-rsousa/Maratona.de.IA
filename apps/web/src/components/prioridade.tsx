import { CODIGOS } from "@farol/shared";

/** Modificador BEM por código (0 = mais urgente), na ordem de CODIGOS. */
const MODIFICADOR = ["emergente", "urgente", "alta", "media", "baixa"] as const;

/** Etiqueta de prioridade: cor do código + nome (a informação nunca depende só da cor). */
export function Pill({ codigo, bloco }: { codigo: number; bloco?: boolean }) {
  const mod = MODIFICADOR[codigo];
  const classe = ["badge", mod && `badge--${mod}`, bloco && "badge--block"].filter(Boolean).join(" ");
  return <span className={classe}>{CODIGOS[codigo] ?? `Código ${codigo}`}</span>;
}
