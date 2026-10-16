import { describe, expect, it } from "vitest";
import {
  REGRAS_DEMO, VERSAO_DEMO, escolherVersaoDaOS, planejarReclassificacao, versaoEfetiva,
  type Fatos, type ModoPublicacao, type OSParaCalculo, type VersaoPontuacao, type VersaoPublicada,
} from "./index";

const T0 = Date.parse("2026-03-01T12:00:00Z");
const H = 3_600_000;

/** Versão de teste: todos os pontos de "Tipo de manutenção → Corretiva" vão para `extra`, para os resultados diferirem. */
function pub(id: string, cidadeId: string | null, numero: number, modo: ModoPublicacao, vigenciaMs: number, extra = 5): VersaoPublicada {
  const versao: VersaoPontuacao = { ...structuredClone(VERSAO_DEMO), v: numero };
  versao.criterios.find((c) => c.id === "tipo")!.opcoes.find((o) => o.label === "Corretiva")!.pontos = extra;
  return { id, cidadeId, numero, vigenciaInicioMs: vigenciaMs, modo, versao };
}

const g1 = pub("g1", null, 1, "novas", T0 - 10 * H, 5);
const FATOS: Fatos = { vida: "Nenhum risco", essencial: "Não", reserva: "Sim", pessoas: "1–10", estrutura: "Sem risco" };

const os = (o: Partial<OSParaCalculo> = {}): OSParaCalculo => ({
  cidade: "BH", tipo: "Corretiva", fatos: FATOS, abertaEmMs: T0, prazoLimiteMs: null, versaoId: "g1",
  anterior: { codigo: 4, pontos: 7, nivel: 0 }, // pessoas 2 + corretiva 5 + espera 0 + prazo 0
  ...o,
});
const plano = (o: OSParaCalculo, publicadas: VersaoPublicada[], agoraMs: number, migrar: boolean, motivo = "Reclassificação automática (tempo)") =>
  planejarReclassificacao(o, { publicadas, regras: REGRAS_DEMO, agoraMs, migrar, motivo });

describe("versão efetiva (OS novas)", () => {
  it("a da cidade prevalece sobre a global, mesmo sendo de número menor", () => {
    const g2 = pub("g2", null, 2, "novas", T0 - H);
    const bh1 = pub("bh1", "BH", 1, "novas", T0 - H);
    expect(versaoEfetiva("BH", [g1, g2, bh1], T0)!.id).toBe("bh1");
    expect(versaoEfetiva("CT", [g1, g2, bh1], T0)!.id).toBe("g2");
  });

  it("versão que ainda não entrou em vigência não vale", () => {
    const g2 = pub("g2", null, 2, "novas", T0 + H);
    expect(versaoEfetiva("BH", [g1, g2], T0)!.id).toBe("g1");
    expect(versaoEfetiva("BH", [g1, g2], T0 + H)!.id).toBe("g2");
    expect(versaoEfetiva("BH", [g2], T0)).toBeUndefined();
  });
});

describe("a OS fica na versão com que foi calculada", () => {
  it("recálculo comum usa a versão da OS, não a vigente", () => {
    // v2 vigente vale 20 pontos para corretiva; a OS está na v1 (5 pontos) e NÃO deve ser calculada com a v2
    const g2 = pub("g2", null, 2, "reclassificar", T0 - H, 20);
    const p = plano(os(), [g1, g2], T0 + 5 * 60_000, false)!;
    expect(p.versao.id).toBe("g1");
    expect(p.migrou).toBe(false);
    expect(p.resultado.versao).toBe(1);
    expect(p.resultado.pontos).toBe(7);
  });

  it("os fatos de tempo mudam o resultado, mas sempre com a versão da OS", () => {
    const g2 = pub("g2", null, 2, "novas", T0 - H, 20);
    // 5 h de espera → "> 4 h" (+10): 2 + 5 + 10 = 17 → Média; segue na v1
    const p = plano(os(), [g1, g2], T0 + 5 * H, true)!;
    expect(p.versao.id).toBe("g1");
    expect(p.migrou).toBe(false);
    expect(p.resultado.pontos).toBe(17);
    expect(p.resultado.versao).toBe(1);
    expect(p.gravar).toBe(true);
    expect(p.motivo).toBe("Reclassificação automática (tempo)");
  });

  it("sem mudança de código, pontos ou precedência não grava resultado", () => {
    const p = plano(os(), [g1], T0 + 10 * 60_000, true)!;
    expect(p.gravar).toBe(false);
    expect(p.migrou).toBe(false);
  });
});

describe("migração de versão", () => {
  const novas = pub("g2", null, 2, "novas", T0 - H, 20);
  const reclass = pub("g2", null, 2, "reclassificar", T0 - H, 20);

  it("versão 'somente novas OS' nunca alcança OS existentes, nem com migração ligada", () => {
    const e = escolherVersaoDaOS({ cidade: "BH", versaoId: "g1" }, [g1, novas], T0, true)!;
    expect(e.versao.id).toBe("g1");
    expect(e.migrou).toBe(false);
  });

  it("'reclassificar' migra a OS aberta, grava novo resultado 'Nova versão vN' e muda o vínculo", () => {
    const p = plano(os(), [g1, reclass], T0 + 60_000, true)!;
    expect(p.migrou).toBe(true);
    expect(p.versao.id).toBe("g2");
    expect(p.resultado.versao).toBe(2);
    expect(p.resultado.pontos).toBe(22); // 2 + 20 + 0
    expect(p.gravar).toBe(true);
    expect(p.motivo).toBe("Nova versão v2");
  });

  it("migra mesmo que o resultado numérico não mude (a versão usada fica registrada)", () => {
    const igual = pub("g2", null, 2, "reclassificar", T0 - H, 5); // mesmos pontos da v1
    const p = plano(os(), [g1, igual], T0 + 60_000, true)!;
    expect(p.migrou).toBe(true);
    expect(p.gravar).toBe(true);
    expect(p.resultado.pontos).toBe(7);
    expect(p.motivo).toBe("Nova versão v2");
  });

  it("só migra quando a vigência chegou", () => {
    const futura = pub("g2", null, 2, "reclassificar", T0 + 2 * H, 20);
    expect(plano(os(), [g1, futura], T0 + H, true)!.migrou).toBe(false);
    const depois = plano(os(), [g1, futura], T0 + 2 * H, true)!;
    expect(depois.migrou).toBe(true);
    expect(depois.versao.id).toBe("g2");
  });

  it("recálculo fora da rotina (migrar = false) nunca troca de versão", () => {
    const p = plano(os(), [g1, reclass], T0 + 60_000, false, "Solicitação vinculada")!;
    expect(p.migrou).toBe(false);
    expect(p.versao.id).toBe("g1");
  });

  it("OS já na versão nova não migra de novo", () => {
    const p = plano(os({ versaoId: "g2", anterior: { codigo: 3, pontos: 22, nivel: 0 } }), [g1, reclass], T0 + 60_000, true)!;
    expect(p.migrou).toBe(false);
    expect(p.gravar).toBe(false);
  });

  it("depois de migrar para a v2, uma v3 'novas' não alcança a OS", () => {
    const v3 = pub("g3", null, 3, "novas", T0 - 60_000, 30);
    const e = escolherVersaoDaOS({ cidade: "BH", versaoId: "g2" }, [g1, reclass, v3], T0, true)!;
    expect(e.versao.id).toBe("g2");
    expect(e.migrou).toBe(false);
  });

  it("v2 'reclassificar' seguida de v3 'novas': a OS na v1 vai para a v2, independente de quando a rotina rodou", () => {
    const v3 = pub("g3", null, 3, "novas", T0 - 60_000, 30);
    const e = escolherVersaoDaOS({ cidade: "BH", versaoId: "g1" }, [g1, reclass, v3], T0, true)!;
    expect(e.versao.id).toBe("g2");
    expect(e.migrou).toBe(true);
  });

  it("entre várias que reclassificam, vale a mais nova", () => {
    const v3 = pub("g3", null, 3, "reclassificar", T0 - 60_000, 30);
    const e = escolherVersaoDaOS({ cidade: "BH", versaoId: "g1" }, [g1, reclass, v3], T0, true)!;
    expect(e.versao.id).toBe("g3");
  });
});

describe("escopo de cidade na migração", () => {
  it("versão da cidade com 'reclassificar' alcança as OS da cidade, não as de outras", () => {
    const bh1 = pub("bh1", "BH", 1, "reclassificar", T0 - H, 20);
    const bh = escolherVersaoDaOS({ cidade: "BH", versaoId: "g1" }, [g1, bh1], T0, true)!;
    expect(bh.versao.id).toBe("bh1");
    expect(bh.migrou).toBe(true);
    const ct = escolherVersaoDaOS({ cidade: "CT", versaoId: "g1" }, [g1, bh1], T0, true)!;
    expect(ct.versao.id).toBe("g1");
    expect(ct.migrou).toBe(false);
  });

  it("versão global não alcança OS de uma cidade que tem versão própria", () => {
    const bh1 = pub("bh1", "BH", 1, "novas", T0 - 2 * H, 8);
    const g2 = pub("g2", null, 2, "reclassificar", T0 - H, 20);
    const e = escolherVersaoDaOS({ cidade: "BH", versaoId: "bh1" }, [g1, bh1, g2], T0, true)!;
    expect(e.versao.id).toBe("bh1");
    expect(e.migrou).toBe(false);
  });

  it("numeração é por escopo: v2 da cidade não se compara com v2 da global", () => {
    const g2 = pub("g2", null, 2, "reclassificar", T0 - H, 20);
    const bh1 = pub("bh1", "BH", 1, "novas", T0 - H, 8);
    const bh2 = pub("bh2", "BH", 2, "novas", T0 - H, 9);
    // OS de CT está na global v1: só a global v2 a alcança
    expect(escolherVersaoDaOS({ cidade: "CT", versaoId: "g1" }, [g1, g2, bh1, bh2], T0, true)!.versao.id).toBe("g2");
  });
});

describe("OS sem vínculo", () => {
  it("usa a versão vigente e registra o vínculo", () => {
    const p = plano(os({ versaoId: null }), [g1], T0 + 60_000, false)!;
    expect(p.versao.id).toBe("g1");
    expect(p.migrou).toBe(true);
    expect(p.gravar).toBe(true);
    expect(p.motivo).toBe("Vínculo à versão v1");
  });

  it("sem nenhuma versão vigente não há plano", () => {
    expect(plano(os({ versaoId: null }), [], T0, true)).toBeUndefined();
  });
});

describe("versão do conjunto de regras (camada A)", () => {
  const vr = (numero: number, motivoDeRegras = true) => ({ numero, justificativa: "Subir estrutura", motivoDeRegras });
  const plano2 = (o: OSParaCalculo, regras = REGRAS_DEMO, versaoRegras: ReturnType<typeof vr> | null = vr(2), publicadas = [g1], migrar = false) =>
    planejarReclassificacao(o, { publicadas, regras, agoraMs: T0 + 60_000, migrar, motivo: "Reclassificação automática (tempo)", versaoRegras: versaoRegras ?? undefined })!;
  // regra nova que alcança a OS de teste (pessoas 1–10): código e nível mudam
  const regraNova = { id: "R-NOVA", nome: "Nova", ativa: true, nivel: 5, prioridadeMinima: 0, cond: [{ criterio: "pessoas", opcoes: ["1–10"] }] };

  it("OS numa versão anterior, com resultado diferente: grava e o motivo é 'Regras vN: <justificativa>'", () => {
    const p = plano2(os({ regrasVersao: 1 }), [...REGRAS_DEMO, regraNova]);
    expect(p.desatualizada).toBe(true);
    expect(p.gravar).toBe(true);
    expect(p.motivo).toBe("Regras v2: Subir estrutura");
    expect(p.resultado).toMatchObject({ codigo: 0, nivel: 5 });
    expect(p.regrasVersao).toBe(2);
  });

  it("OS numa versão anterior, resultado igual: NÃO grava resultado, mas fica marcada para receber o novo carimbo", () => {
    const p = plano2(os({ regrasVersao: 1 }));
    expect(p.desatualizada).toBe(true);
    expect(p.gravar).toBe(false);
    expect(p.regrasVersao).toBe(2);
  });

  it("OS sem carimbo (nunca marcada) conta como versão anterior", () => {
    expect(plano2(os({ regrasVersao: null })).desatualizada).toBe(true);
    expect(plano2(os()).desatualizada).toBe(true);
  });

  it("OS já na versão em vigor não é tocada: motivo comum, sem 'Regras vN'", () => {
    const p = plano2(os({ regrasVersao: 2 }), [...REGRAS_DEMO, regraNova]);
    expect(p.desatualizada).toBe(false);
    expect(p.gravar).toBe(true); // o resultado mudou por outro motivo (regras já aplicadas antes do carimbo)
    expect(p.motivo).toBe("Reclassificação automática (tempo)");
  });

  it("fora da rotina (motivoDeRegras desligado) mantém o motivo de quem chamou, mas ainda carimba", () => {
    const p = plano2(os({ regrasVersao: 1 }), [...REGRAS_DEMO, regraNova], vr(2, false));
    expect(p.motivo).toBe("Reclassificação automática (tempo)");
    expect(p.desatualizada).toBe(true);
    expect(p.regrasVersao).toBe(2);
  });

  it("sem informar a versão das regras nada muda no comportamento anterior", () => {
    const p = plano2(os({ regrasVersao: 1 }), REGRAS_DEMO, null);
    expect(p.desatualizada).toBe(false);
    expect(p.regrasVersao).toBeNull();
    expect(p.gravar).toBe(false);
  });

  it("migração de pontuação e regras novas na mesma volta: o motivo registra as duas", () => {
    const g2 = pub("g2", null, 2, "reclassificar", T0 - H, 20);
    const p = plano2(os({ regrasVersao: 1 }), [...REGRAS_DEMO, regraNova], vr(2), [g1, g2], true);
    expect(p.migrou).toBe(true);
    expect(p.motivo).toBe("Nova versão v2; Regras v2: Subir estrutura");
  });

  it("só grava se código, pontos ou nível mudarem: regra que não alcança a OS não gera resultado", () => {
    const naoAlcanca = { ...regraNova, cond: [{ criterio: "vida", opcoes: ["Cabo energizado / choque"] }] };
    const p = plano2(os({ regrasVersao: 1 }), [...REGRAS_DEMO, naoAlcanca]);
    expect(p.gravar).toBe(false);
    expect(p.desatualizada).toBe(true);
  });
});
