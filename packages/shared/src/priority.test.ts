import { describe, expect, it } from "vitest";
import {
  REGRAS_DEMO, VERSAO_DEMO, calcularPrioridade, fatosAutomaticos, ordenarFila,
  transicaoManualPermitida, type Fatos, type ItemFila,
} from "./index";

const base: Fatos = {
  vida: "Nenhum risco", essencial: "Não", reserva: "Sim", pessoas: "1–10",
  estrutura: "Sem risco", tipo: "Corretiva",
};
const calc = (f: Fatos) => calcularPrioridade({ ...base, ...f }, VERSAO_DEMO, REGRAS_DEMO);

describe("pontuação (camada B)", () => {
  it("soma pontos e cai na faixa certa", () => {
    // 2 (pessoas) + 5 (corretiva) + 0 espera = 7 → Baixa
    const r = calc({ espera: "Até 1 h", prazo: "Sem prazo" });
    expect(r.pontos).toBe(7);
    expect(r.codigo).toBe(4);
  });

  it("informação desconhecida NÃO é risco zero", () => {
    const r = calc({ vida: undefined });
    const item = r.itens.find((i) => i.criterio === "Risco à vida")!;
    expect(item.pontos).toBe(15);
    expect(item.requerConfirmacao).toBe(true);
  });
});

describe("precedência (camada A)", () => {
  it("hospital sem reserva vira Emergente mesmo com pontos baixos", () => {
    const r = calc({ essencial: "Hospital / emergência", reserva: "Não" });
    expect(r.codigo).toBe(0);
    expect(r.nivel).toBe(2);
    expect(r.motivoPrincipal).toContain("Serviço essencial sem reserva");
  });

  it("risco à vida garante no mínimo Urgente e nível 3", () => {
    const r = calc({ vida: "Cabo energizado / choque" });
    expect(r.codigo).toBeLessThanOrEqual(1);
    expect(r.nivel).toBe(3);
  });

  it("preventiva com prazo vencido sobe pela regra, não por número escondido", () => {
    const r = calc({ tipo: "Preventiva", prazo: "< 24 h ou vencido" });
    expect(r.regrasAplicadas).toContain("R-PREV");
    expect(r.codigo).toBeLessThanOrEqual(2);
  });
});

describe("fatos automáticos", () => {
  it("espera e prazo derivados do relógio", () => {
    const agora = Date.now();
    const f = fatosAutomaticos({ aberturaMs: agora - 300 * 60_000, prazoH: -1 }, agora);
    expect(f.espera).toBe("> 4 h");
    expect(f.prazo).toBe("< 24 h ou vencido");
  });
});

describe("fila (§2)", () => {
  const t0 = 1_700_000_000_000;
  const mk = (o: Partial<ItemFila>): ItemFila => ({
    num: "BH-2026-0001", cidade: "BH", nivel: 0, codigo: 3, tipo: "Corretiva",
    pontos: 10, prazoMs: null, aberturaMs: t0, ...o,
  });

  it("CR01: hospital + 2.000 clientes antes de 30 clientes sem luz", () => {
    const hospital = mk({ num: "BH-2026-0003", nivel: 2, codigo: 0, pontos: 80 });
    const trinta = mk({ num: "BH-2026-0001", nivel: 0, codigo: 3, pontos: 20 });
    const fila = ordenarFila([trinta, hospital]);
    expect(fila[0]!.num).toBe("BH-2026-0003");
  });

  it("corretiva antes de preventiva em prioridade equivalente", () => {
    const prev = mk({ num: "BH-2026-0001", tipo: "Preventiva", pontos: 50 });
    const corr = mk({ num: "BH-2026-0002", tipo: "Corretiva", pontos: 10 });
    expect(ordenarFila([prev, corr])[0]!.num).toBe("BH-2026-0002");
  });

  it("posição é calculada dentro da cidade", () => {
    const fila = ordenarFila([
      mk({ num: "BH-2026-0001", cidade: "BH" }),
      mk({ num: "CT-2026-0001", cidade: "CT" }),
    ]);
    expect(fila.map((x) => x.posicao)).toEqual([1, 1]);
  });

  it("desempate final é determinístico pelo número da OS", () => {
    const a = mk({ num: "BH-2026-0002" });
    const b = mk({ num: "BH-2026-0001" });
    expect(ordenarFila([a, b])[0]!.num).toBe("BH-2026-0001");
    expect(ordenarFila([b, a])[0]!.num).toBe("BH-2026-0001");
  });
});

// A validação completa (erros e alertas do §5) está em validate.test.ts.

describe("status (§10)", () => {
  it("só permite transições manuais previstas", () => {
    expect(transicaoManualPermitida("Aberta", "Em triagem")).toBe(true);
    expect(transicaoManualPermitida("Aberta", "Concluída")).toBe(false);
    expect(transicaoManualPermitida("Concluída", "Aguardando despacho")).toBe(true);
  });
});
