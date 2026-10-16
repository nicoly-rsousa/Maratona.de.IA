import { describe, expect, it } from "vitest";
import {
  CENARIOS_CR, FATOS_BASE_DEMO, PreverRegrasSchema, REGRAS_DEMO, SalvarRegrasSchema, VERSAO_DEMO, calcularCenario, preverImpacto, validarRegras,
  type Fatos, type OSParaImpacto, type Regra, type VersaoPontuacao, type VersaoPublicada,
} from "./index";

const AGORA = Date.parse("2026-03-10T15:00:00Z");
const H = 3_600_000;
const regras = (): Regra[] => structuredClone(REGRAS_DEMO);
const regra = (o: Partial<Regra> = {}): Regra => ({
  id: "R-NOVA", nome: "Regra nova", ativa: true, nivel: 2, prioridadeMinima: 1,
  cond: [{ criterio: "pessoas", opcoes: ["> 100"] }], ...o,
});
/** Troca (ou acrescenta) uma regra pelo id. */
const com = (rs: Regra[], r: Regra) => (rs.some((x) => x.id === r.id) ? rs.map((x) => (x.id === r.id ? r : x)) : [...rs, r]);
const sem = (rs: Regra[], id: string) => rs.filter((r) => r.id !== id);
const erros = (rs: Regra[], v: VersaoPontuacao = VERSAO_DEMO) => validarRegras(rs, v).erros;
const alertas = (rs: Regra[], v: VersaoPontuacao = VERSAO_DEMO) => validarRegras(rs, v).alertas;

describe("validarRegras — o que bloqueia", () => {
  it("as regras demonstrativas são válidas na versão demonstrativa, sem erros nem alertas", () => {
    expect(validarRegras(REGRAS_DEMO, VERSAO_DEMO)).toEqual({ erros: [], alertas: [] });
  });

  it("nível vai de 1 a 10, inteiro", () => {
    for (const n of [1, 10]) expect(erros([regra({ nivel: n })])).toEqual([]);
    for (const n of [0, 11, -1, 2.5, Number.NaN]) expect(erros([regra({ nivel: n })]).join(" ")).toMatch(/nível/i);
  });

  it("prioridade mínima vai de 0 a 4, inteira", () => {
    for (const p of [0, 1, 2, 3, 4]) expect(erros([regra({ prioridadeMinima: p })])).toEqual([]);
    for (const p of [-1, 5, 1.5, Number.NaN]) expect(erros([regra({ prioridadeMinima: p })]).join(" ")).toMatch(/prioridade mínima/i);
  });

  it("exige pelo menos uma condição", () => {
    expect(erros([regra({ cond: [] })]).join(" ")).toMatch(/pelo menos uma condição/i);
  });

  it("condição sem opções é erro", () => {
    expect(erros([regra({ cond: [{ criterio: "pessoas", opcoes: [] }] })]).join(" ")).toMatch(/ao menos uma opção/i);
  });

  it("a condição tem de apontar para um critério que existe na versão de pontuação", () => {
    const e = erros([regra({ cond: [{ criterio: "inexistente", opcoes: ["x"] }] })]);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/critério "inexistente" não existe/i);
    expect(e[0]).toContain("v1");
  });

  it("e para opções que existem nesse critério", () => {
    const e = erros([regra({ cond: [{ criterio: "pessoas", opcoes: ["> 100", "milhões"] }] })]);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatch(/opção "milhões" não existe em "Pessoas afetadas"/i);
  });

  it("critérios e opções vêm da versão recebida, nunca de uma lista fixa", () => {
    const outra: VersaoPontuacao = structuredClone(VERSAO_DEMO);
    outra.criterios.find((c) => c.id === "vida")!.opcoes.find((o) => o.label === "Cabo energizado / choque")!.label = "Fio no chão";
    // a regra R-VIDA do demo cita a opção antiga: agora é erro; com o rótulo novo, passa
    expect(erros(REGRAS_DEMO, outra).join(" ")).toMatch(/Cabo energizado \/ choque/);
    const ajustadas = com(regras(), { ...REGRAS_DEMO[0]!, cond: [{ criterio: "vida", opcoes: ["Fio no chão"] }] });
    expect(erros(ajustadas, outra)).toEqual([]);
  });

  it("critério repetido na mesma regra e opção repetida na mesma condição são erros", () => {
    const rep = regra({ cond: [{ criterio: "pessoas", opcoes: ["> 100"] }, { criterio: "pessoas", opcoes: ["11–100"] }] });
    expect(erros([rep]).join(" ")).toMatch(/critério "Pessoas afetadas" aparece mais de uma vez/i);
    expect(erros([regra({ cond: [{ criterio: "pessoas", opcoes: ["> 100", "> 100"] }] })]).join(" ")).toMatch(/repetida/i);
  });

  it("id obrigatório, no formato certo e único; nome obrigatório", () => {
    expect(erros([regra({ id: "" })]).join(" ")).toMatch(/identificador/i);
    expect(erros([regra({ id: "com espaço" })]).join(" ")).toMatch(/identificador/i);
    expect(erros([regra({ id: "R-A" }), regra({ id: "R-A", nome: "Outra" })]).join(" ")).toMatch(/repetido/i);
    expect(erros([regra({ nome: "   " })]).join(" ")).toMatch(/nome/i);
  });

  it("conjunto vazio é erro: mantenha ao menos uma regra (desative em vez de apagar todas)", () => {
    const r = validarRegras([], VERSAO_DEMO);
    expect(r.erros).toEqual(["Mantenha ao menos uma regra."]);
    expect(r.alertas).toEqual([]);
  });

  it("reúne todos os erros de uma vez (não para no primeiro)", () => {
    const e = erros([regra({ nivel: 0, prioridadeMinima: 9, cond: [] })]);
    expect(e.length).toBeGreaterThanOrEqual(3);
  });

  it("o critério 'tipo' e os de tempo (prazo, espera) também são válidos: estão na versão de pontuação", () => {
    expect(erros([regra({ cond: [{ criterio: "tipo", opcoes: ["Preventiva"] }, { criterio: "espera", opcoes: ["> 4 h"] }] })])).toEqual([]);
  });
});

describe("validarRegras — alertas (não bloqueiam)", () => {
  it("prioridade mínima Baixa não muda o código, só o nível", () => {
    const r = validarRegras([regra({ prioridadeMinima: 4 })], VERSAO_DEMO);
    expect(r.erros).toEqual([]);
    expect(r.alertas.join(" ")).toMatch(/Baixa/);
  });

  it("critério desabilitado na versão de pontuação", () => {
    const v: VersaoPontuacao = structuredClone(VERSAO_DEMO);
    v.criterios.find((c) => c.id === "pessoas")!.habilitado = false;
    const r = validarRegras([regra()], v);
    expect(r.erros).toEqual([]);
    expect(r.alertas.join(" ")).toMatch(/desabilitado/i);
  });

  it("nenhuma regra ativa (mas o conjunto existe): alerta, tudo passa a depender só da pontuação", () => {
    expect(alertas([regra({ ativa: false })]).join(" ")).toMatch(/nenhuma regra ativa/i);
    expect(erros([regra({ ativa: false })])).toEqual([]);
  });

  it("critério ou opção que falta na versão própria de outra cidade vira alerta, não erro", () => {
    const ct: VersaoPontuacao = structuredClone(VERSAO_DEMO);
    ct.criterios = ct.criterios.filter((c) => c.id !== "estrutura");
    const r = validarRegras(REGRAS_DEMO, VERSAO_DEMO, [{ escopo: "CT", versao: ct }]);
    expect(r.erros).toEqual([]);
    expect(r.alertas.some((a) => a.includes("CT") && /estrutura/i.test(a))).toBe(true);
  });

  it("cidade com versão própria sem nenhuma incompatibilidade real: sem alerta nenhum sobre ela", () => {
    // mesma versão da global: nenhum critério ou opção falta (incompatibilidade real = o que importa, não "ter versão própria")
    const r = validarRegras(REGRAS_DEMO, VERSAO_DEMO, [{ escopo: "CT", versao: structuredClone(VERSAO_DEMO) }]);
    expect(r.erros).toEqual([]);
    expect(r.alertas.some((a) => a.includes("CT"))).toBe(false);
  });

  it("várias cidades, só a que tem incompatibilidade real aparece no alerta", () => {
    const compativel: VersaoPontuacao = structuredClone(VERSAO_DEMO);
    const incompativel: VersaoPontuacao = structuredClone(VERSAO_DEMO);
    incompativel.criterios = incompativel.criterios.filter((c) => c.id !== "estrutura");
    const r = validarRegras(REGRAS_DEMO, VERSAO_DEMO, [{ escopo: "CT", versao: compativel }, { escopo: "BH", versao: incompativel }]);
    expect(r.alertas.some((a) => a.includes("CT"))).toBe(false);
    expect(r.alertas.some((a) => a.includes("BH") && /estrutura/i.test(a))).toBe(true);
  });

  it("nenhuma cidade com versão própria: sem nenhum alerta sobre cidade", () => {
    expect(validarRegras(REGRAS_DEMO, VERSAO_DEMO, []).alertas).toEqual([]);
  });
});

describe("corpo das requisições", () => {
  it("salvar exige versão base e justificativa", () => {
    expect(SalvarRegrasSchema.safeParse({ regras: [], versaoBase: 1, justificativa: "  " }).success).toBe(false);
    expect(SalvarRegrasSchema.safeParse({ regras: [], versaoBase: 0, justificativa: "ok" }).success).toBe(false);
    expect(SalvarRegrasSchema.safeParse({ regras: regras(), versaoBase: 1, justificativa: " ajuste " })).toMatchObject({ success: true, data: { justificativa: "ajuste" } });
  });

  it("não derruba a validação com tipos errados: quem decide é validarRegras", () => {
    expect(PreverRegrasSchema.safeParse({ regras: [{ id: "x", nome: "n", ativa: true, cond: [], nivel: 99, prioridadeMinima: -3 }] }).success).toBe(true);
    expect(PreverRegrasSchema.safeParse({ regras: "nada" }).success).toBe(false);
  });
});

// ───────── previsão de impacto ─────────
const pub = (id: string, numero: number, modo: "novas" | "reclassificar", vig: number, extra: number): VersaoPublicada => {
  const versao: VersaoPontuacao = { ...structuredClone(VERSAO_DEMO), v: numero };
  versao.criterios.find((c) => c.id === "tipo")!.opcoes.find((o) => o.label === "Corretiva")!.pontos = extra;
  return { id, cidadeId: null, numero, vigenciaInicioMs: vig, modo, versao };
};
const v1 = pub("v1", 1, "novas", AGORA - 100 * H, 5);
const FB = FATOS_BASE_DEMO as Fatos;

const os = (numero: string, fatos: Fatos = {}, o: Partial<OSParaImpacto> = {}): OSParaImpacto => ({
  id: `id-${numero}`, numero, cidade: "BH", tipo: "Corretiva", fatos: { ...FB, ...fatos },
  abertaEmMs: AGORA - 10 * 60_000, prazoLimiteMs: null, versaoId: "v1", ...o,
});
const baixa = os("BH-1");                                                              // 7 pts → Baixa, nível 0
const queda = os("BH-2", { estrutura: "Risco de queda" });                             // 32 pts → Alta; R-EST (nível 1, mín. Alta)
const vida = os("BH-3", { vida: "Cabo energizado / choque" });                         // 47 pts → Urgente; R-VIDA (nível 3)
const prev = os("BH-4", {}, { tipo: "Preventiva", prazoLimiteMs: AGORA + 10 * H });    // 17 pts → Média pela faixa; R-PREV sobe para Alta
const hosp = os("BH-5", { essencial: "Hospital / emergência", reserva: "Desconhecida", pessoas: "> 100" }); // 70 pts → Emergente; R-ESS
const todas = [baixa, queda, vida, prev, hosp];
const imp = (novas: Regra[], abertas = todas, pubs = [v1]) => preverImpacto(abertas, pubs, REGRAS_DEMO, novas, AGORA);

describe("preverImpacto", () => {
  it("as mesmas regras não mudam nada: antes e depois idênticos", () => {
    const r = imp(regras());
    expect(r).toMatchObject({ total: 5, semVersao: 0, mudaram: 0, codigoMudou: 0, nivelMudou: 0, sobemCodigo: 0, descemCodigo: 0, mudancas: [] });
    expect(r.distribuicao.depois).toEqual(r.distribuicao.antes);
  });

  it("conta as OS por código antes e depois (a soma é sempre o total)", () => {
    const r = imp(regras());
    expect(r.distribuicao.antes).toEqual([1, 1, 2, 0, 1]); // hosp; vida; queda + prev (sobe por regra); baixa
    expect(r.distribuicao.antes.reduce((a, b) => a + b, 0)).toBe(5);
  });

  it("subir a prioridade mínima da regra de estrutura muda só a OS com risco de queda", () => {
    const r = imp(com(regras(), { ...REGRAS_DEMO[2]!, prioridadeMinima: 0 }));
    expect(r.mudaram).toBe(1);
    expect(r.codigoMudou).toBe(1);
    expect(r.nivelMudou).toBe(0);
    expect(r.sobemCodigo).toBe(1);
    expect(r.descemCodigo).toBe(0);
    expect(r.mudancas).toHaveLength(1);
    expect(r.mudancas[0]).toMatchObject({
      numero: "BH-2",
      antes: { codigo: 2, nivel: 1, regras: ["R-EST"] },
      depois: { codigo: 0, nivel: 1, regras: ["R-EST"] },
    });
    expect(r.distribuicao.depois).toEqual([2, 1, 1, 0, 1]);
  });

  it("mudar só o nível aparece como mudança de nível, sem mudar o código", () => {
    const r = imp(com(regras(), { ...REGRAS_DEMO[2]!, nivel: 7 }));
    expect(r).toMatchObject({ mudaram: 1, codigoMudou: 0, nivelMudou: 1, sobemCodigo: 0, descemCodigo: 0 });
    expect(r.mudancas[0]).toMatchObject({ numero: "BH-2", antes: { nivel: 1 }, depois: { nivel: 7 } });
  });

  it("desativar a regra preventiva derruba a OS que só estava Alta por causa dela", () => {
    const r = imp(com(regras(), { ...REGRAS_DEMO[3]!, ativa: false }));
    expect(r.mudaram).toBe(1);
    expect(r.descemCodigo).toBe(1);
    expect(r.mudancas[0]).toMatchObject({ numero: "BH-4", antes: { codigo: 2, nivel: 1 }, depois: { codigo: 3, nivel: 0, regras: [] } });
  });

  it("remover a regra de vida zera o nível da OS com cabo energizado, mas o código segue pela pontuação", () => {
    const r = imp(sem(regras(), "R-VIDA"));
    expect(r.mudancas).toHaveLength(1);
    expect(r.mudancas[0]).toMatchObject({ numero: "BH-3", antes: { codigo: 1, nivel: 3 }, depois: { codigo: 1, nivel: 0 } });
    expect(r.codigoMudou).toBe(0);
    expect(r.nivelMudou).toBe(1);
  });

  it("uma regra nova alcança as OS que casam com ela", () => {
    const nova = regra({ nivel: 4, prioridadeMinima: 0, cond: [{ criterio: "vida", opcoes: ["Cabo energizado / choque"] }] });
    const r = imp([...regras(), nova]);
    expect(r.mudancas.map((m) => m.numero)).toEqual(["BH-3"]);
    expect(r.mudancas[0]).toMatchObject({ depois: { codigo: 0, nivel: 4, regras: ["R-VIDA", "R-NOVA"] } });
  });

  it("os pontos nunca mudam: regra não mexe na pontuação", () => {
    const r = imp([]);
    for (const m of r.mudancas) expect(m.antes.pontos).toBe(m.depois.pontos);
    expect(r.mudaram).toBe(4); // todas menos a OS sem regra nenhuma
  });

  it("calcula com a versão de pontuação em que cada OS está, não com a vigente", () => {
    // v2 vigente valeria 30 pontos para corretiva; a OS está na v1 (5 pontos): o impacto é medido na v1
    const v2 = pub("v2", 2, "reclassificar", AGORA - H, 30);
    const r = imp(sem(regras(), "R-EST"), [queda], [v1, v2]);
    expect(r.mudancas[0]!.antes.pontos).toBe(32);
    expect(r.mudancas[0]!.depois.pontos).toBe(32);
  });

  it("OS sem nenhuma versão de pontuação publicada é contada à parte, sem derrubar a previsão", () => {
    const r = imp(regras(), [baixa, queda], []);
    expect(r).toMatchObject({ total: 2, semVersao: 2, mudaram: 0 });
  });

  it("não altera as entradas e é determinística; mudanças saem em ordem de cidade e número", () => {
    const abertas = [hosp, { ...queda, cidade: "CT", numero: "CT-1" }, queda, vida];
    const copia = structuredClone(abertas);
    const novas = regras().map((x) => ({ ...x, nivel: 9 }));
    const a = imp(novas, abertas);
    const b = imp(novas, abertas);
    expect(a).toEqual(b);
    expect(abertas).toEqual(copia);
    expect(a.mudancas.map((m) => m.numero)).toEqual([...a.mudancas.map((m) => m.numero)].sort((x, y) => x.localeCompare(y)));
    expect(a.mudancas.map((m) => m.numero)).toEqual(["BH-2", "BH-3", "BH-5", "CT-1"]);
  });
});

describe("cenários CR-01 a CR-04 seguem iguais com regras reaplicadas pelo editor", () => {
  it("um conjunto de regras ida-e-volta (validado, copiado e recalculado) não muda nenhum cenário", () => {
    const copia = JSON.parse(JSON.stringify(REGRAS_DEMO)) as Regra[];
    expect(validarRegras(copia, VERSAO_DEMO).erros).toEqual([]);
    for (const c of CENARIOS_CR) {
      expect(calcularCenario(c, VERSAO_DEMO, copia, AGORA)).toEqual(calcularCenario(c, VERSAO_DEMO, REGRAS_DEMO, AGORA));
    }
  });
});
