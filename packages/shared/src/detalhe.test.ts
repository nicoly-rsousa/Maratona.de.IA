import { describe, expect, it } from "vitest";
import { montarHistorico, type LinhaResultado } from "./detalhe";

const linha = (id: number, em: string, extra: Partial<LinhaResultado> = {}): LinhaResultado => ({
  id, versao: 1, itens: [{ criterio: "Risco à vida", opcoes: ["Desconhecido"], pontos: 15, requerConfirmacao: true }],
  pontos: 15, codigo_faixa: 3, regras_aplicadas: [], nivel: 0, codigo: 3,
  motivo_principal: "Pontuação: Risco à vida", motivo_calculo: "Abertura", calculado_em: em, ...extra,
});

describe("montarHistorico", () => {
  const nomes = new Map([["R-VIDA", "Risco iminente à vida"]]);

  it("mais recente primeiro; resultado = o mais recente", () => {
    const h = montarHistorico([
      linha(1, "2026-01-01T10:00:00Z"),
      linha(3, "2026-01-01T12:00:00Z", { codigo: 1, motivo_calculo: "Reclassificação automática (tempo)" }),
      linha(2, "2026-01-01T11:00:00Z"),
    ], nomes);
    expect(h.historico.map((r) => r.id)).toEqual([3, 2, 1]);
    expect(h.resultado?.id).toBe(3);
    expect(h.resultado?.motivoCalculo).toBe("Reclassificação automática (tempo)");
  });

  it("resolve o nome das regras e cai no id quando a regra não existe mais", () => {
    const h = montarHistorico([linha(1, "2026-01-01T10:00:00Z", { regras_aplicadas: ["R-VIDA", "R-ANTIGA"] })], nomes);
    expect(h.resultado?.regrasAplicadas).toEqual([
      { id: "R-VIDA", nome: "Risco iminente à vida" },
      { id: "R-ANTIGA", nome: "R-ANTIGA" },
    ]);
  });

  it("preserva 'requer confirmação' e pontos dos itens (desconhecido não é zero)", () => {
    const r = montarHistorico([linha(1, "2026-01-01T10:00:00Z")], nomes).resultado!;
    expect(r.itens[0]).toMatchObject({ pontos: 15, requerConfirmacao: true });
  });

  it("sem resultados: resultado null e histórico vazio", () => {
    expect(montarHistorico([], nomes)).toEqual({ resultado: null, historico: [] });
  });
});
