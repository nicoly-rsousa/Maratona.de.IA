import type { OSRedeLeve, RespostaOS } from "@/lib/rede-api";

/** Distribuição real da carga local (prioridade legada → classe mapeada): soma 4.513. */
export const CONTAGEM_REAL = { c0: 130, c1: 1167, c2: 1463, c3: 1077, c4: 676 } as const;
export const TOTAL_REAL = 4513;
export const SEM_CIRCUITO_REAL = 40;

/** Gera as 4.513 OS com a distribuição real e 40 OS de circuito não identificado espalhadas entre as classes. */
export function gerarOSReais(): OSRedeLeve[] {
  const classes: number[] = [];
  (Object.values(CONTAGEM_REAL) as number[]).forEach((qtd, codigo) => { for (let i = 0; i < qtd; i++) classes.push(codigo); });
  return classes.map((codigo, i) => {
    const sem = i % 113 === 0 && i / 113 < SEM_CIRCUITO_REAL; // 40 OS, uma a cada 113
    return {
      numero: `OS-${String(i).padStart(5, "0")}`,
      circuito: sem ? (i === 0 ? "CQT1-CQT" : "CET-LUM 2") : `C-${i % 277}`,
      circuito_origem: sem ? "nao_identificado" : "importado",
      lat: -21.5 + (i % 100) / 1000, lng: -42.6 + (i % 90) / 1000,
      municipio: "MUNICIPIO", prioridade_legada: ["EMERGENCIAL", "URGENTE", "ALTA", "<15 DIAS", "BAIXA"][codigo]!,
      prioridade_codigo: codigo, prazo: null, tipo_servico: "serviço",
    } satisfies OSRedeLeve;
  });
}

export function respostaOS(os: OSRedeLeve[], extra: Partial<RespostaOS> = {}): RespostaOS {
  return { importado_em: "2026-10-19T04:00:00Z", total: os.length, filtro_regional: { configurada: false, aplicado: false }, os, ...extra };
}
