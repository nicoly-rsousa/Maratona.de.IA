const MIN = 60_000;

export const minutosDesde = (iso: string) => Math.max(0, Math.round((Date.now() - Date.parse(iso)) / MIN));

/** Horas restantes até o prazo-limite; "vencido" se já passou. */
export function prazoTexto(iso: string | null): string {
  if (!iso) return "—";
  const h = (Date.parse(iso) - Date.now()) / 3_600_000;
  return h < 0 ? "vencido" : `${Math.round(h)} h`;
}

export const dataHora = (iso: string) => new Date(iso).toLocaleString("pt-BR");
