import { FATOS_BASE_DEMO, type OSDemo } from "./demo";
import { calcularPrioridade, fatosAutomaticos } from "./priority";
import type { ItemFila } from "./queue";
import type { Fatos, Regra, ResultadoPrioridade, VersaoPontuacao } from "./types";

/**
 * Cenários de referência CR-01 a CR-04 (relatório, seção 12), em BH. Os pesos e faixas continuam DEMONSTRATIVOS
 * (ND01–ND03): quem decide é a versão publicada e as regras do banco; aqui só estão os fatos de cada ocorrência.
 * Os mesmos dados alimentam cenarios.test.ts e `npm run seed:cr`, para a demonstração ser a prova do teste.
 *
 * Mapeamento para os critérios da v1 demonstrativa: "30 clientes" = "11–100"; "2.000 clientes" = "> 100";
 * "local de pouca circulação" = "1–10".
 */
export interface OSCenario extends OSDemo {
  cenario: "CR-01" | "CR-02" | "CR-03" | "CR-04";
  /** identificação curta, igual ao início do endereço: "CR-01 A" */
  chave: string;
}

const cr = (
  cenario: OSCenario["cenario"], letra: string, descricao: string,
  d: Omit<OSDemo, "endereco" | "tipo" | "prazoH" | "fatos"> & Partial<Pick<OSDemo, "tipo" | "prazoH" | "exigeQualificacao">> & { fatos?: Record<string, string> },
): OSCenario => ({
  cenario, chave: `${cenario} ${letra}`, endereco: `${cenario} ${letra} — ${descricao}`,
  tipo: "Corretiva", prazoH: null, ...d, fatos: { ...FATOS_BASE_DEMO, ...d.fatos },
});

export const CENARIOS_CR: OSCenario[] = [
  // CR-01: 30 clientes sem local crítico × hospital com 2.000 clientes (a mais nova passa à frente)
  cr("CR-01", "A", "cruzeta, 30 clientes", { cidade: "BH", x: 20, y: 22, transformador: "7010001", uc: "2010001", abertaMinAtras: 30, fatos: { essencial: "Desconhecido", pessoas: "11–100" } }),
  cr("CR-01", "B", "cruzeta, hospital e 2.000 clientes", { cidade: "BH", x: 62, y: 24, transformador: "7010002", uc: "2010002", abertaMinAtras: 20, fatos: { essencial: "Hospital / emergência", reserva: "Não", pessoas: "> 100" } }),
  // CR-02: cruzeta que afeta hospital (reserva desconhecida) × cruzeta em rua de pouca circulação, aberta há mais tempo
  cr("CR-02", "A", "cruzeta que afeta hospital", { cidade: "BH", x: 28, y: 62, transformador: "7020001", uc: "2020001", abertaMinAtras: 15, fatos: { essencial: "Hospital / emergência", reserva: "Desconhecida", pessoas: "11–100" } }),
  cr("CR-02", "B", "cruzeta em rua de pouca circulação", { cidade: "BH", x: 82, y: 62, transformador: "7020002", uc: "2020002", abertaMinAtras: 300, fatos: { pessoas: "1–10" } }),
  // CR-03: preventiva programada (prazo longe) × corretiva × preventiva com prazo iminente
  cr("CR-03", "A", "preventiva programada, prazo em 10 dias", { cidade: "BH", x: 12, y: 44, transformador: "7030001", uc: "2030001", abertaMinAtras: 120, tipo: "Preventiva", prazoH: 240, fatos: { pessoas: "11–100" } }),
  cr("CR-03", "B", "corretiva comum", { cidade: "BH", x: 44, y: 84, transformador: "7030002", uc: "2030002", abertaMinAtras: 40, fatos: { pessoas: "11–100" } }),
  cr("CR-03", "C", "preventiva com prazo em 10 h", { cidade: "BH", x: 72, y: 86, transformador: "7030003", uc: "2030003", abertaMinAtras: 120, tipo: "Preventiva", prazoH: 10, fatos: { pessoas: "11–100" } }),
  // CR-04: duas ocorrências disputando uma equipe de capacidade 1 (BH-B)
  cr("CR-04", "A", "cruzeta quebrada com risco de queda", { cidade: "BH", x: 52, y: 8, transformador: "7040001", uc: "2040001", abertaMinAtras: 25, fatos: { estrutura: "Risco de queda", pessoas: "11–100" } }),
  cr("CR-04", "B", "cruzeta, 150 clientes", { cidade: "BH", x: 92, y: 12, transformador: "7040002", uc: "2040002", abertaMinAtras: 35, fatos: { pessoas: "> 100" } }),
];

export const cenario = (chave: string): OSCenario => {
  const c = CENARIOS_CR.find((x) => x.chave === chave);
  if (!c) throw new Error(`Cenário desconhecido: ${chave}`);
  return c;
};

/** Fatos como o motor os recebe: informados + tipo + tempo (espera e prazo calculados no instante `agoraMs`). */
export function fatosDoCenario(c: OSCenario, agoraMs: number): Fatos {
  const abertaEm = agoraMs - c.abertaMinAtras * 60_000;
  return { ...c.fatos, tipo: c.tipo, ...fatosAutomaticos({ aberturaMs: abertaEm, prazoH: c.prazoH }, agoraMs) };
}

export function calcularCenario(c: OSCenario, versao: VersaoPontuacao, regras: Regra[], agoraMs: number): ResultadoPrioridade {
  return calcularPrioridade(fatosDoCenario(c, agoraMs), versao, regras);
}

/** Item da fila (identificado pela chave do cenário) para `ordenarFila`. */
export function itemFilaDoCenario(c: OSCenario, r: ResultadoPrioridade, agoraMs: number): ItemFila {
  return {
    num: c.chave, cidade: c.cidade, nivel: r.nivel, codigo: r.codigo, tipo: c.tipo, pontos: r.pontos,
    prazoMs: c.prazoH == null ? null : agoraMs + c.prazoH * 3_600_000, aberturaMs: agoraMs - c.abertaMinAtras * 60_000,
  };
}
