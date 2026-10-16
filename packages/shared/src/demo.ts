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

/** OS demonstrativas do protótipo docs/farol.html (BH e CT). Posição em unidades do mapa (0–100, 1 un = 20 m). */
export interface OSDemo {
  cidade: string;
  endereco: string;
  x: number;
  y: number;
  transformador?: string;
  uc?: string;
  /** minutos desde a abertura */
  abertaMinAtras: number;
  tipo: "Corretiva" | "Preventiva";
  prazoH: number | null;
  fatos: Record<string, string>;
  /** qualificação exigida (equipe com "Linha viva" etc.) */
  exigeQualificacao?: string;
}

const FATOS_BASE_DEMO = { vida: "Nenhum risco", essencial: "Não", reserva: "Sim", pessoas: "1–10", estrutura: "Sem risco" };
const osDemo = (d: Omit<OSDemo, "tipo" | "prazoH" | "fatos"> & Partial<Pick<OSDemo, "tipo" | "prazoH">> & { fatos?: Record<string, string> }): OSDemo => ({
  tipo: "Corretiva", prazoH: null, ...d, fatos: { ...FATOS_BASE_DEMO, ...d.fatos },
});

export const OS_DEMO: OSDemo[] = [
  osDemo({ cidade: "BH", endereco: "R. das Acácias, 120", x: 30, y: 35, transformador: "1234567", uc: "1000001", abertaMinAtras: 50 }),
  osDemo({ cidade: "BH", endereco: "Av. Central, 900", x: 33, y: 38, transformador: "1234567", uc: "1000002", abertaMinAtras: 300, exigeQualificacao: "Linha viva", fatos: { vida: "Cabo energizado / choque" } }),
  osDemo({ cidade: "BH", endereco: "Hospital Santa Luz", x: 60, y: 55, transformador: "2223344", uc: "1000003", abertaMinAtras: 20, fatos: { essencial: "Hospital / emergência", reserva: "Desconhecida", pessoas: "> 100" } }),
  osDemo({ cidade: "BH", endereco: "R. do Poste, 15", x: 75, y: 70, transformador: "3334455", uc: "1000004", abertaMinAtras: 90, fatos: { estrutura: "Risco de queda" } }),
  osDemo({ cidade: "BH", endereco: "Subestação Norte", x: 20, y: 75, transformador: "4445566", abertaMinAtras: 40, tipo: "Preventiva", prazoH: 10 }),
  osDemo({ cidade: "BH", endereco: "Praça Verde, 4", x: 50, y: 20, transformador: "5556677", uc: "1000006", abertaMinAtras: 400, fatos: { pessoas: "11–100" } }),
  osDemo({ cidade: "BH", endereco: "R. Sul, 77", x: 85, y: 30, transformador: "6667788", abertaMinAtras: 15, tipo: "Preventiva", prazoH: 100 }),
  osDemo({ cidade: "BH", endereco: "R. Lago, 3", x: 15, y: 15, transformador: "7778899", abertaMinAtras: 200, fatos: { pessoas: "Desconhecido", vida: "Desconhecido" } }),
  osDemo({ cidade: "CT", endereco: "Av. Industrial, 500", x: 45, y: 48, transformador: "8889900", abertaMinAtras: 70, fatos: { pessoas: "11–100" } }),
  osDemo({ cidade: "CT", endereco: "R. Pedreira, 9", x: 70, y: 30, transformador: "9990011", abertaMinAtras: 130, fatos: { estrutura: "Risco de queda" } }),
  osDemo({ cidade: "CT", endereco: "Clínica Boa Vida", x: 30, y: 70, transformador: "1011121", abertaMinAtras: 10, fatos: { essencial: "Hospital / emergência", reserva: "Não" } }),
];

/** Converte a posição do mapa do protótipo (0–100, centro = 50,50, 20 m por unidade) em lat/lng ao redor do centro da cidade. */
export function coordenadaDemo(centro: { lat: number; lng: number }, x: number, y: number): { lat: number; lng: number } {
  const M_POR_UN = 20;
  const M_POR_GRAU_LAT = 111_320;
  const dLat = ((50 - y) * M_POR_UN) / M_POR_GRAU_LAT;
  const dLng = ((x - 50) * M_POR_UN) / (M_POR_GRAU_LAT * Math.cos((centro.lat * Math.PI) / 180));
  return { lat: centro.lat + dLat, lng: centro.lng + dLng };
}

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
