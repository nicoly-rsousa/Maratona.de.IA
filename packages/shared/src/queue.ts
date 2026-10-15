export interface ItemFila {
  num: string;
  cidade: string;
  nivel: number;
  codigo: number; // 0 mais urgente
  tipo: "Corretiva" | "Preventiva";
  pontos: number;
  /** epoch ms do prazo corrente; null = sem prazo */
  prazoMs: number | null;
  aberturaMs: number;
}

const INF = Number.POSITIVE_INFINITY;

/** Ordem da fila: regra de negócio §2. */
export function compararFila(a: ItemFila, b: ItemFila): number {
  return (
    b.nivel - a.nivel || // 1. precedência (maior primeiro)
    a.codigo - b.codigo || // 2. código (mais urgente primeiro)
    (a.tipo === b.tipo ? 0 : a.tipo === "Corretiva" ? -1 : 1) || // 3. corretiva antes de preventiva
    b.pontos - a.pontos || // 4. pontuação
    (a.prazoMs ?? INF) - (b.prazoMs ?? INF) || // 5. prazo mais próximo/vencido
    a.aberturaMs - b.aberturaMs || // 6. mais antiga
    a.num.localeCompare(b.num) // 7. desempate determinístico
  );
}

/** A posição é sempre calculada dentro da cidade da OS (inclusive em "Todas as cidades"). */
export function ordenarFila(itens: ItemFila[]): (ItemFila & { posicao: number })[] {
  const porCidade = new Map<string, ItemFila[]>();
  for (const i of itens) porCidade.set(i.cidade, [...(porCidade.get(i.cidade) ?? []), i]);
  const out: (ItemFila & { posicao: number })[] = [];
  for (const lista of porCidade.values()) {
    lista.sort(compararFila).forEach((i, k) => out.push({ ...i, posicao: k + 1 }));
  }
  return out.sort((a, b) => a.cidade.localeCompare(b.cidade) || a.posicao - b.posicao);
}
