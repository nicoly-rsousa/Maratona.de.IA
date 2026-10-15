import type { Regra, VersaoPontuacao } from "./types";

/**
 * Valores DEMONSTRATIVOS e NÃO OFICIAIS (mesmos do protótipo farol.html).
 * Pesos, faixas e regras reais vêm do banco (ND01–ND03 indefinidos no relatório).
 */
type Def = [id: string, nome: string, agreg: "soma" | "max", ops: [string, number, boolean?][]];

const DEFS: Def[] = [
  ["vida", "Risco à vida", "soma", [["Nenhum risco", 0], ["Cabo energizado / choque", 40], ["Desconhecido", 15, true]]],
  ["essencial", "Serviço essencial", "soma", [["Não", 0], ["Hospital / emergência", 30], ["Desconhecido", 10, true]]],
  ["reserva", "Fonte de reserva", "soma", [["Sim", 0], ["Não", 20], ["Desconhecida", 10, true]]],
  ["pessoas", "Pessoas afetadas", "soma", [["1–10", 2], ["11–100", 10], ["> 100", 25], ["Desconhecido", 8, true]]],
  ["estrutura", "Estrutura", "soma", [["Sem risco", 0], ["Risco de queda", 25], ["Desconhecido", 10, true]]],
  ["tipo", "Tipo de manutenção", "soma", [["Corretiva", 5], ["Preventiva", 0]]],
  ["prazo", "Prazo-limite (auto)", "soma", [["Sem prazo", 0], ["> 72 h", 0], ["24–72 h", 5], ["< 24 h ou vencido", 15]]],
  ["espera", "Tempo de espera (auto)", "soma", [["Até 1 h", 0], ["1–4 h", 5], ["> 4 h", 10]]],
];

const DESCONHECIDAS = new Set(["Desconhecido", "Desconhecida"]);

export const VERSAO_DEMO: VersaoPontuacao = {
  v: 1,
  criterios: DEFS.map(([id, nome, agregacao, ops]) => ({
    id, nome, agregacao, habilitado: true,
    opcoes: ops.map(([label, pontos, rc]) => ({
      label, pontos, desconhecida: DESCONHECIDAS.has(label), requerConfirmacao: !!rc,
    })),
  })),
  faixas: [
    { de: 0, ate: 9, cod: 4 },
    { de: 10, ate: 24, cod: 3 },
    { de: 25, ate: 44, cod: 2 },
    { de: 45, ate: 69, cod: 1 },
    { de: 70, ate: null, cod: 0 },
  ],
};

export const REGRAS_DEMO: Regra[] = [
  { id: "R-VIDA", nome: "Risco iminente à vida", ativa: true, nivel: 3, prioridadeMinima: 1,
    cond: [{ criterio: "vida", opcoes: ["Cabo energizado / choque"] }] },
  { id: "R-ESS", nome: "Serviço essencial sem reserva", ativa: true, nivel: 2, prioridadeMinima: 0,
    cond: [{ criterio: "essencial", opcoes: ["Hospital / emergência"] }, { criterio: "reserva", opcoes: ["Não", "Desconhecida"] }] },
  { id: "R-EST", nome: "Estrutura com risco de queda", ativa: true, nivel: 1, prioridadeMinima: 2,
    cond: [{ criterio: "estrutura", opcoes: ["Risco de queda"] }] },
  { id: "R-PREV", nome: "Preventiva com prazo iminente", ativa: true, nivel: 1, prioridadeMinima: 2,
    cond: [{ criterio: "tipo", opcoes: ["Preventiva"] }, { criterio: "prazo", opcoes: ["< 24 h ou vencido"] }] },
];
