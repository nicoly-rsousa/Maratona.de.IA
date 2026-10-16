import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  exigeMotivo, permissaoDaTransicao, todasTransicoes, transicaoManualPermitida, transicoesManuais, type StatusOS,
} from "./status";

describe("transições manuais de status (§10)", () => {
  it("permite as transições do §10", () => {
    expect(transicaoManualPermitida("Aberta", "Em triagem")).toBe(true);
    expect(transicaoManualPermitida("Aberta", "Aguardando despacho")).toBe(true);
    expect(transicaoManualPermitida("Aguardando despacho", "Suspensa")).toBe(true);
    expect(transicaoManualPermitida("Suspensa", "Aguardando despacho")).toBe(true);
    expect(transicaoManualPermitida("Em execução", "Aguardando recurso")).toBe(true);
    expect(transicaoManualPermitida("Aguardando recurso", "Em execução")).toBe(true);
    expect(transicaoManualPermitida("Concluída", "Aguardando despacho")).toBe(true);
  });

  it("recusa qualquer outra (inclusive as do ciclo do despacho)", () => {
    expect(transicaoManualPermitida("Aberta", "Concluída")).toBe(false);
    expect(transicaoManualPermitida("Aguardando despacho", "Equipe designada")).toBe(false);
    expect(transicaoManualPermitida("Equipe designada", "A caminho")).toBe(false);
    expect(transicaoManualPermitida("Em execução", "Concluída")).toBe(false);
    expect(transicaoManualPermitida("Cancelada", "Aguardando despacho")).toBe(false);
    expect(transicoesManuais("Cancelada")).toEqual([]);
    expect(transicoesManuais("A caminho")).toEqual([]);
  });

  it("cancelar exige permissão cancelar; reabrir, reabrir; o resto, status", () => {
    expect(permissaoDaTransicao("Aberta", "Cancelada")).toBe("cancelar");
    expect(permissaoDaTransicao("Aguardando despacho", "Cancelada")).toBe("cancelar");
    expect(permissaoDaTransicao("Concluída", "Aguardando despacho")).toBe("reabrir");
    expect(permissaoDaTransicao("Aberta", "Em triagem")).toBe("status");
    expect(permissaoDaTransicao("Em execução", "Aguardando recurso")).toBe("status");
  });

  it("cancelar, suspender e reabrir exigem motivo", () => {
    expect(exigeMotivo("Aberta", "Cancelada")).toBe(true);
    expect(exigeMotivo("Aguardando despacho", "Suspensa")).toBe(true);
    expect(exigeMotivo("Concluída", "Aguardando despacho")).toBe(true);
    expect(exigeMotivo("Aberta", "Em triagem")).toBe(false);
    expect(exigeMotivo("Suspensa", "Aguardando despacho")).toBe(false);
  });
});

// A migration 0004 guarda as mesmas transições na tabela transicoes_status (as funções do banco leem dela).
describe("paridade com supabase/migrations/0004_status_despacho.sql", () => {
  const sql = readFileSync(new URL("../../../supabase/migrations/0004_status_despacho.sql", import.meta.url), "utf8");
  const bloco = sql.split("-- BEGIN transicoes")[1]?.split("-- END transicoes")[0] ?? "";
  const linhas = [...bloco.matchAll(/\('([^']+)',\s*'([^']+)',\s*'([^']+)',\s*(true|false)\)/g)].map((m) => ({
    de: m[1]!, para: m[2]! as StatusOS, permissao: m[3]!, motivo: m[4] === "true",
  }));

  it("o SQL e o código listam exatamente as mesmas transições", () => {
    const sqlSet = linhas.map((l) => `${l.de}>${l.para}`).sort();
    const tsSet = todasTransicoes().map((t) => `${t.de}>${t.para}`).sort();
    expect(sqlSet.length).toBeGreaterThan(0);
    expect(sqlSet).toEqual(tsSet);
  });

  it("permissão e exigência de motivo coincidem", () => {
    for (const l of linhas) {
      expect(l.permissao, `${l.de} → ${l.para}`).toBe(permissaoDaTransicao(l.de, l.para));
      expect(l.motivo, `${l.de} → ${l.para}`).toBe(exigeMotivo(l.de, l.para));
    }
  });
});
