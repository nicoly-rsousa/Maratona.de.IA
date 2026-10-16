import { describe, expect, it } from "vitest";
import { VERSAO_DEMO, validarVersao, type VersaoPontuacao } from "./index";

// O máximo é configuração do banco; aqui é só um valor de teste.
const MAX = 100;
const clone = (): VersaoPontuacao => structuredClone(VERSAO_DEMO);
const val = (v: VersaoPontuacao, max = MAX) => validarVersao(v, max);

describe("validação de versão — erros (bloqueiam)", () => {
  it("a versão demonstrativa não tem erros", () => {
    expect(val(clone()).erros).toEqual([]);
  });

  it("pontos nulos (sem pontos definidos) bloqueiam e não são tratados como zero", () => {
    const v = clone();
    v.criterios[0]!.opcoes[1]!.pontos = null;
    const r = val(v);
    expect(r.erros).toHaveLength(1);
    expect(r.erros[0]).toContain("sem pontos definidos");
    // zero é um valor válido e diferente de nulo
    v.criterios[0]!.opcoes[1]!.pontos = 0;
    expect(val(v).erros).toEqual([]);
  });

  it("pontos acima do máximo recebido por parâmetro bloqueiam", () => {
    const v = clone();
    v.criterios[0]!.opcoes[1]!.pontos = 41; // demo: 40
    expect(val(v, 40).erros.join()).toContain("acima do máximo (40)");
    expect(val(v, 41).erros).toEqual([]);
  });

  it("pontos negativos ou não inteiros bloqueiam", () => {
    const v = clone();
    v.criterios[0]!.opcoes[0]!.pontos = -1;
    v.criterios[1]!.opcoes[0]!.pontos = 2.5;
    expect(val(v).erros).toHaveLength(2);
  });

  it("critério desabilitado não bloqueia mesmo com pontos nulos", () => {
    const v = clone();
    v.criterios[0]!.habilitado = false;
    v.criterios[0]!.opcoes[1]!.pontos = null;
    expect(val(v).erros).toEqual([]);
  });

  it("detecta lacuna e sobreposição de faixas", () => {
    const v = clone();
    v.faixas[1]!.de = 12; // lacuna 9→12
    expect(val(v).erros.join()).toContain("Lacuna");
    const w = clone();
    w.faixas[1]!.de = 8; // sobreposição
    expect(val(w).erros.join()).toContain("Sobreposição");
  });

  it("as faixas têm de ir de 0 até 'sem limite'", () => {
    const comeca = clone();
    comeca.faixas[0]!.de = 1;
    expect(val(comeca).erros.join()).toContain("começar em 0");

    const termina = clone();
    termina.faixas[termina.faixas.length - 1]!.ate = 200;
    expect(val(termina).erros.join()).toContain('"sem limite"');

    const meio = clone();
    meio.faixas[1]!.ate = null;
    expect(val(meio).erros.join()).toContain("só pode ser a última");

    const vazia = clone();
    vazia.faixas = [];
    expect(val(vazia).erros).toContain("Nenhuma faixa definida.");
  });

  it("faixas fora de ordem são ordenadas antes de validar", () => {
    const v = clone();
    v.faixas.reverse();
    expect(val(v).erros).toEqual([]);
  });
});

describe("validação de versão — alertas (não bloqueiam)", () => {
  it("a versão demonstrativa só tem o alerta de critérios sem opção desconhecida", () => {
    const r = val(clone());
    expect(r.alertas.length).toBeGreaterThan(0);
    expect(r.alertas.every((a) => a.includes('sem opção "desconhecida"'))).toBe(true);
  });

  it('opção desconhecida valendo 0 sem "requer confirmação" alerta', () => {
    const v = clone();
    const desc = v.criterios[0]!.opcoes.find((o) => o.desconhecida)!;
    desc.pontos = 0;
    desc.requerConfirmacao = false;
    const r = val(v);
    expect(r.alertas.join()).toContain('opção desconhecida vale 0 sem "requer confirmação"');
    expect(r.erros).toEqual([]);
    // com "requer confirmação" o alerta some
    desc.requerConfirmacao = true;
    expect(val(v).alertas.join()).not.toContain('vale 0 sem "requer confirmação"');
  });

  it("critério sem opção desconhecida alerta", () => {
    const v = clone();
    const c = v.criterios[0]!;
    c.opcoes.forEach((o) => { o.desconhecida = false; });
    expect(val(v).alertas.join()).toContain(`"${c.nome}": sem opção "desconhecida"`);
  });

  it("Essencial valendo menos que Residencial alerta, sem bloquear", () => {
    const v = clone();
    v.criterios.push({
      id: "classe", nome: "Classe do cliente", habilitado: true, agregacao: "max",
      opcoes: [
        { label: "Residencial", pontos: 10, desconhecida: false, requerConfirmacao: false },
        { label: "Essencial", pontos: 5, desconhecida: false, requerConfirmacao: false },
        { label: "Desconhecida", pontos: 8, desconhecida: true, requerConfirmacao: true },
      ],
    });
    const r = val(v);
    expect(r.alertas.join()).toContain('"Essencial" vale 5, menos que "Residencial" (10)');
    expect(r.erros).toEqual([]);

    v.criterios.at(-1)!.opcoes[1]!.pontos = 10; // empate não alerta
    expect(val(v).alertas.join()).not.toContain("menos que");
  });

  it("Essencial sem pontos definidos gera erro, não o alerta de coerência", () => {
    const v = clone();
    v.criterios.push({
      id: "classe", nome: "Classe do cliente", habilitado: true, agregacao: "max",
      opcoes: [
        { label: "Residencial", pontos: 10, desconhecida: false, requerConfirmacao: false },
        { label: "Essencial", pontos: null, desconhecida: false, requerConfirmacao: false },
      ],
    });
    const r = val(v);
    expect(r.erros.join()).toContain("sem pontos definidos");
    expect(r.alertas.join()).not.toContain("menos que");
  });
});
