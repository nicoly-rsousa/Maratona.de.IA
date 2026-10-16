import { describe, expect, it } from "vitest";
import {
  CENARIOS_CR, CODIGOS, REGRAS_DEMO, VERSAO_DEMO, avaliarEquipe, calcularCenario, cenario, itemFilaDoCenario, ordenarFila, recomendarEquipes,
  type EquipeCandidata, type OSCenario, type ResultadoPrioridade,
} from "./index";

/**
 * Cenários de referência CR-01 a CR-04 (relatório, seção 12) passando pelo motor completo
 * (calcularPrioridade + ordenarFila). Pesos e faixas são os DEMONSTRATIVOS da v1 (ND01–ND03):
 * as asserções explicam a decisão (regra aplicada, nível, pontos), não só a ordem.
 */
const AGORA = Date.parse("2026-03-10T15:00:00Z");

const calc = (c: OSCenario, agora = AGORA): ResultadoPrioridade => calcularCenario(c, VERSAO_DEMO, REGRAS_DEMO, agora);
const pontosDe = (r: ResultadoPrioridade, criterio: string) => r.itens.find((i) => i.criterio === criterio)!.pontos;

/** Ordem da fila de BH só com os cenários pedidos; devolve as chaves da primeira à última. */
function fila(chaves: string[], agora = AGORA, trocar: Record<string, OSCenario> = {}): string[] {
  const itens = chaves.map((k) => {
    const c = trocar[k] ?? cenario(k);
    return itemFilaDoCenario(c, calc(c, agora), agora);
  });
  return ordenarFila(itens).map((i) => i.num);
}

describe("CR-01 — 30 clientes sem local crítico × hospital com 2.000 clientes", () => {
  const A = calc(cenario("CR-01 A"));
  const B = calc(cenario("CR-01 B"));

  it("a do hospital fica à frente, mesmo tendo sido aberta depois", () => {
    expect(cenario("CR-01 B").abertaMinAtras).toBeLessThan(cenario("CR-01 A").abertaMinAtras); // B é mais nova
    expect(fila(["CR-01 A", "CR-01 B"])).toEqual(["CR-01 B", "CR-01 A"]);
  });

  it("a diferença vem de uma regra de precedência explicável, não de um número escondido", () => {
    expect(B.regrasAplicadas).toEqual(["R-ESS"]);
    expect(B.nivel).toBe(2);
    expect(B.motivoPrincipal).toBe("Pontuação: Serviço essencial"); // já era Emergente pelos pontos; a regra garante o piso
    expect(A.regrasAplicadas).toEqual([]);
    expect(A.nivel).toBe(0);
  });

  it("e de pontos que se explicam critério a critério", () => {
    // B: hospital 30 + sem reserva 20 + > 100 pessoas 25 + corretiva 5 = 80 (Emergente)
    expect(pontosDe(B, "Serviço essencial")).toBe(30);
    expect(pontosDe(B, "Fonte de reserva")).toBe(20);
    expect(pontosDe(B, "Pessoas afetadas")).toBe(25);
    expect(B.pontos).toBe(80);
    expect(CODIGOS[B.codigo]).toBe("Emergente");
    // A: serviço essencial desconhecido 10 + 11–100 pessoas 10 + corretiva 5 = 25 (Alta)
    expect(pontosDe(A, "Serviço essencial")).toBe(10);
    expect(pontosDe(A, "Pessoas afetadas")).toBe(10);
    expect(A.pontos).toBe(25);
    expect(CODIGOS[A.codigo]).toBe("Alta");
  });

  it("serviço essencial desconhecido não é risco zero: soma pontos e pede confirmação (§3)", () => {
    const essencialA = A.itens.find((i) => i.criterio === "Serviço essencial")!;
    expect(essencialA.opcoes).toEqual(["Desconhecido"]);
    expect(essencialA.requerConfirmacao).toBe(true);
    expect(A.regrasAplicadas).toEqual([]); // só "Hospital / emergência" aciona a R-ESS
  });
});

describe("CR-02 — cruzeta que afeta hospital × cruzeta em local de pouca circulação", () => {
  const hospital = calc(cenario("CR-02 A"));
  const pouca = calc(cenario("CR-02 B"));

  it("a de menor impacto aguarda: posição posterior", () => {
    const f = fila(["CR-02 B", "CR-02 A"]);
    expect(f.indexOf("CR-02 A") + 1).toBe(1);
    expect(f.indexOf("CR-02 B") + 1).toBe(2);
  });

  it("reserva desconhecida não é risco zero: o hospital sobe pela regra, não pelos pontos", () => {
    // 30 + 10 (reserva desconhecida) + 10 + 5 = 55 → Urgente pelos pontos; a regra R-ESS eleva a Emergente
    expect(pontosDe(hospital, "Fonte de reserva")).toBe(10);
    expect(hospital.pontos).toBe(55);
    expect(CODIGOS[hospital.codigoFaixa]).toBe("Urgente");
    expect(hospital.regrasAplicadas).toContain("R-ESS");
    expect(CODIGOS[hospital.codigo]).toBe("Emergente");
    expect(hospital.motivoPrincipal).toBe("Regra de precedência: Serviço essencial sem reserva");
    expect(hospital.itens.find((i) => i.criterio === "Fonte de reserva")!.requerConfirmacao).toBe(true);
  });

  it("a de pouca circulação não tem regra nenhuma e é baixa por pontos", () => {
    expect(pouca.regrasAplicadas).toEqual([]);
    expect(pouca.nivel).toBe(0);
    expect(pouca.pontos).toBe(17); // 2 (1–10) + 5 (corretiva) + 10 (espera > 4 h)
    expect(CODIGOS[pouca.codigo]).toBe("Média");
  });

  it("estar na fila há mais tempo não passa na frente da precedência", () => {
    expect(cenario("CR-02 B").abertaMinAtras).toBeGreaterThan(cenario("CR-02 A").abertaMinAtras); // B é bem mais antiga
    expect(pontosDe(pouca, "Tempo de espera (auto)")).toBe(10); // o tempo já deu pontos a ela…
    expect(fila(["CR-02 B", "CR-02 A"])[0]).toBe("CR-02 A"); // …e mesmo assim a do hospital vai primeiro
  });
});

describe("CR-03 — preventiva programada × corretiva, até a regra de prazo iminente", () => {
  const prog = cenario("CR-03 A");

  it("lado 1: com o prazo longe, a preventiva programada não passa a corretiva", () => {
    const p = calc(prog);
    const corretiva = calc(cenario("CR-03 B"));
    expect(p.itens.find((i) => i.criterio === "Prazo-limite (auto)")!.opcoes).toEqual(["> 72 h"]);
    expect(p.regrasAplicadas).toEqual([]);
    expect(p.nivel).toBe(0);
    // mesma prioridade (Média) e até os mesmos pontos (15 = 10 de pessoas + 5 de espera na preventiva; 10 + 5 de corretiva
    // na outra): quem desempata é o TIPO, corretiva antes de preventiva (§2.3). Nenhum número escondido.
    expect(p.codigo).toBe(corretiva.codigo);
    expect(CODIGOS[p.codigo]).toBe("Média");
    expect(p.pontos).toBe(15);
    expect(corretiva.pontos).toBe(15);
    expect(fila(["CR-03 A", "CR-03 B"])).toEqual(["CR-03 B", "CR-03 A"]);
  });

  it("lado 2: com o prazo iminente (< 24 h) a regra a antecipa, e passa a corretiva", () => {
    const c = cenario("CR-03 C");
    const r = calc(c);
    expect(r.itens.find((i) => i.criterio === "Prazo-limite (auto)")!.opcoes).toEqual(["< 24 h ou vencido"]);
    expect(r.regrasAplicadas).toEqual(["R-PREV"]);
    expect(r.nivel).toBe(1);
    expect(r.codigo).toBeLessThanOrEqual(2); // no mínimo Alta
    expect(r.motivoPrincipal).toBe("Pontuação: Prazo-limite (auto)"); // os pontos já a levavam a Alta; a regra garante o piso e o nível
    expect(fila(["CR-03 A", "CR-03 B", "CR-03 C"])).toEqual(["CR-03 C", "CR-03 B", "CR-03 A"]);
  });

  it("é a MESMA OS: só o tempo mudou (prazo de 240 h → 10 h)", () => {
    const antes = calc(prog);
    // 230 h depois da abertura do cenário: o prazo absoluto é o mesmo, então faltam 10 h (e a espera cresceu)
    const depois = calc({ ...prog, prazoH: 240 - 230, abertaMinAtras: prog.abertaMinAtras + 230 * 60 });
    expect(antes.regrasAplicadas).toEqual([]);
    expect(depois.regrasAplicadas).toEqual(["R-PREV"]);
    expect(depois.nivel).toBe(1);
    expect(depois.codigo).toBeLessThan(antes.codigo);
  });

  it("a regra vale na virada exata: 24 h ainda não antecipa; vencida antecipa", () => {
    const com = (prazoH: number): OSCenario => ({ ...prog, prazoH });
    expect(calc(com(24)).regrasAplicadas).toEqual([]);
    expect(calc(com(23.9)).regrasAplicadas).toEqual(["R-PREV"]);
    expect(calc(com(-5)).regrasAplicadas).toEqual(["R-PREV"]);
    // e na fila: com 24 h a corretiva segue à frente; vencida, a preventiva passa
    expect(fila(["CR-03 A", "CR-03 B"], AGORA, { "CR-03 A": com(24) })[0]).toBe("CR-03 B");
    expect(fila(["CR-03 A", "CR-03 B"], AGORA, { "CR-03 A": com(-5) })[0]).toBe("CR-03 A");
  });
});

describe("CR-04 — duas ocorrências e uma equipe de capacidade 1", () => {
  const A = cenario("CR-04 A");
  const B = cenario("CR-04 B");
  const osDe = (c: OSCenario) => ({ cidade: c.cidade, lat: -19.9167, lng: -43.9345, exigeQualificacao: c.exigeQualificacao ?? null });
  const equipe = (carga: number): EquipeCandidata => ({ id: "BH-B", cidade: "BH", capacidade: 1, qualificacoes: [], lat: -19.9185, lng: -43.9307, carga });

  it("a fila define quem é atendida primeiro: risco de queda (regra) antes de 150 clientes", () => {
    const a = calc(A);
    const b = calc(B);
    expect(a.regrasAplicadas).toEqual(["R-EST"]);
    expect(a.nivel).toBe(1);
    expect(b.regrasAplicadas).toEqual([]);
    expect(a.codigo).toBe(b.codigo); // as duas são Alta: a diferença é só a precedência
    expect(CODIGOS[a.codigo]).toBe("Alta");
    expect(fila(["CR-04 B", "CR-04 A"])).toEqual(["CR-04 A", "CR-04 B"]);
  });

  it("a equipe livre é recomendada para a primeira; ocupada, nunca é designável para a segunda", () => {
    const primeira = recomendarEquipes(osDe(A), [equipe(0)]);
    expect(primeira[0]).toMatchObject({ equipe: "BH-B", compativel: true, disponivel: true, carga: 0, capacidade: 1 });

    const segunda = recomendarEquipes(osDe(B), [equipe(1)]); // BH-B já com 1/1
    expect(segunda[0]).toMatchObject({ equipe: "BH-B", disponivel: false });
    expect(avaliarEquipe(osDe(B), equipe(1)).disponivel).toBe(false); // nem exceção libera a capacidade (§9)
  });

  it("a segunda permanece na fila: é a próxima a ser despachada quando houver equipe", () => {
    const restantes = fila(["CR-04 B", "CR-04 A"]).filter((k) => k !== "CR-04 A"); // A saiu da fila ao ser designada
    expect(restantes).toEqual(["CR-04 B"]);
    expect(ordenarFila([itemFilaDoCenario(B, calc(B), AGORA)])[0]!.posicao).toBe(1);
  });
});

describe("os cenários prontos para o seed", () => {
  it("chaves únicas e endereços que identificam o cenário", () => {
    expect(new Set(CENARIOS_CR.map((c) => c.chave)).size).toBe(CENARIOS_CR.length);
    for (const c of CENARIOS_CR) expect(c.endereco.startsWith(c.chave)).toBe(true);
    expect(CENARIOS_CR.every((c) => c.cidade === "BH")).toBe(true);
    expect(CENARIOS_CR.some((c) => /smoke/i.test(c.endereco))).toBe(false);
  });

  it("não se repetem transformador nem UC (a duplicidade da demonstração é escolhida, não acidental)", () => {
    const trafos = CENARIOS_CR.map((c) => c.transformador);
    const ucs = CENARIOS_CR.map((c) => c.uc);
    expect(new Set(trafos).size).toBe(trafos.length);
    expect(new Set(ucs).size).toBe(ucs.length);
  });
});
