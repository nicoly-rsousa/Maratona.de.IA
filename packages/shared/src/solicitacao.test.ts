import { describe, expect, it } from "vitest";
import {
  NovaOSSchema, OS_DEMO, REGRAS_DEMO, VERSAO_DEMO, calcularPrioridade, coordenadaDemo, distanciaM,
  fatosAutomaticos, perguntasDaVersao, statusInicial, sugerirDuplicidade, temLocalizacao, validarFatos, valorInicial,
  type CandidataDuplicidade, type VersaoPontuacao,
} from "./index";

describe("perguntas vindas da versão publicada", () => {
  it("omite critérios automáticos e o tipo, e não expõe pontos", () => {
    const p = perguntasDaVersao(VERSAO_DEMO);
    expect(p.map((x) => x.id)).toEqual(["vida", "essencial", "reserva", "pessoas", "estrutura"]);
    expect(JSON.stringify(p)).not.toContain("pontos");
  });

  it("acompanha a versão: critério novo aparece, desabilitado some", () => {
    const v: VersaoPontuacao = {
      ...VERSAO_DEMO,
      criterios: [
        ...VERSAO_DEMO.criterios.map((c) => (c.id === "vida" ? { ...c, habilitado: false } : c)),
        { id: "novo", nome: "Critério novo", habilitado: true, agregacao: "soma",
          opcoes: [{ label: "A", pontos: 1, desconhecida: false, requerConfirmacao: false }] },
      ],
    };
    const ids = perguntasDaVersao(v).map((x) => x.id);
    expect(ids).not.toContain("vida");
    expect(ids).toContain("novo");
  });

  it("valor inicial é a opção desconhecida (nunca zero); sem ela, vazio", () => {
    const [vida] = perguntasDaVersao(VERSAO_DEMO);
    expect(valorInicial(vida!)).toBe("Desconhecido");
    expect(valorInicial({ id: "x", nome: "X", opcoes: [{ label: "A", desconhecida: false, requerConfirmacao: false }] })).toBe("");
  });

  it("valor inicial gera pontos de 'desconhecido' no motor", () => {
    const fatos = Object.fromEntries(perguntasDaVersao(VERSAO_DEMO).map((p) => [p.id, valorInicial(p)]));
    const r = calcularPrioridade({ ...fatos, tipo: "Corretiva", ...fatosAutomaticos({ aberturaMs: 0, prazoH: null }, 0) }, VERSAO_DEMO, REGRAS_DEMO);
    expect(r.itens.find((i) => i.criterio === "Risco à vida")!.pontos).toBe(15);
  });
});

describe("validarFatos", () => {
  it("aceita opções da versão", () => {
    expect(validarFatos({ vida: "Nenhum risco", pessoas: "> 100" }, VERSAO_DEMO)).toEqual([]);
  });
  it("recusa critério e opção inexistentes, e critérios automáticos", () => {
    expect(validarFatos({ vida: "Inventada" }, VERSAO_DEMO)).toHaveLength(1);
    expect(validarFatos({ zzz: "A" }, VERSAO_DEMO)).toHaveLength(1);
    expect(validarFatos({ prazo: "Sem prazo" }, VERSAO_DEMO)).toHaveLength(1);
  });
});

describe("localização e status inicial (§14.7)", () => {
  it("com coordenadas válidas: Aguardando despacho", () => {
    expect(statusInicial(-19.9, -43.9)).toBe("Aguardando despacho");
  });
  it("sem localização: Em triagem", () => {
    expect(statusInicial(undefined, undefined)).toBe("Em triagem");
    expect(statusInicial(null, -43.9)).toBe("Em triagem");
  });
  it("coordenada fora do intervalo ou NaN não é localização válida", () => {
    expect(temLocalizacao(91, 0)).toBe(false);
    expect(temLocalizacao(0, 181)).toBe(false);
    expect(temLocalizacao(NaN, 0)).toBe(false);
    expect(temLocalizacao(0, 0)).toBe(true);
  });
});

describe("NovaOSSchema", () => {
  const ok = { cidade: "BH", endereco: "Rua A, 10" };
  it("aplica padrões", () => {
    const d = NovaOSSchema.parse(ok);
    expect(d.tipo).toBe("Corretiva");
    expect(d.prazoH).toBeNull();
    expect(d.fatos).toEqual({});
  });
  it("transformador é texto de 4 a 12 dígitos; UC de 6 a 10", () => {
    expect(NovaOSSchema.safeParse({ ...ok, transformador: "123" }).success).toBe(false);
    expect(NovaOSSchema.safeParse({ ...ok, transformador: "0012345" }).success).toBe(true);
    expect(NovaOSSchema.safeParse({ ...ok, uc: "12345" }).success).toBe(false);
    expect(NovaOSSchema.safeParse({ ...ok, uc: "123456" }).success).toBe(true);
  });
  it("lat e lng juntas ou nenhuma", () => {
    expect(NovaOSSchema.safeParse({ ...ok, lat: -19.9 }).success).toBe(false);
    expect(NovaOSSchema.safeParse({ ...ok, lat: -19.9, lng: -43.9 }).success).toBe(true);
  });
});

describe("duplicidade (§11)", () => {
  const AGORA = Date.parse("2026-06-01T12:00:00Z");
  const H = 3_600_000;
  const base: CandidataDuplicidade = {
    id: "1", numero: "BH-2026-0001", cidade: "BH", endereco: "Rua A, 10", status: "Aguardando despacho", codigo: 3, tipo: "Corretiva",
    lat: -19.9167, lng: -43.9345, transformador: "1234567", uc: "1000001", conjunto: null, abertaEmMs: AGORA - H,
  };
  const q = { cidade: "BH", lat: -19.9167, lng: -43.9345 };

  it("distância haversine é coerente (~111 m por 0,001° de latitude)", () => {
    expect(Math.round(distanciaM({ lat: 0, lng: 0 }, { lat: 0.001, lng: 0 }))).toBe(111);
  });

  it("sugere por proximidade ≤ 300 m, não além", () => {
    const perto = { ...base, id: "p", numero: "P", lat: base.lat! + 0.0026, lng: base.lng } // ~289 m
    const longe = { ...base, id: "l", numero: "L", lat: base.lat! + 0.0028, lng: base.lng } // ~311 m
    const r = sugerirDuplicidade(q, [perto, longe], AGORA);
    expect(r.map((s) => s.id)).toEqual(["p"]);
    expect(r[0]!.motivos).toEqual(["proximidade"]);
  });

  it("sugere por mesmo transformador ou mesma UC, mesmo sem coordenadas", () => {
    const c = { ...base, lat: null, lng: null };
    expect(sugerirDuplicidade({ cidade: "BH", transformador: "1234567" }, [c], AGORA)[0]!.motivos).toEqual(["mesmo_transformador"]);
    expect(sugerirDuplicidade({ cidade: "BH", uc: "1000001" }, [c], AGORA)[0]!.motivos).toEqual(["mesma_uc"]);
    expect(sugerirDuplicidade({ cidade: "BH", transformador: "9999999", uc: "2000002" }, [c], AGORA)).toEqual([]);
  });

  it("conjunto só conta junto com o mesmo tipo", () => {
    const c = { ...base, lat: null, lng: null, transformador: null, uc: null, conjunto: "CJ-7" };
    expect(sugerirDuplicidade({ cidade: "BH", conjunto: "CJ-7", tipo: "Corretiva" }, [c], AGORA)).toHaveLength(1);
    expect(sugerirDuplicidade({ cidade: "BH", conjunto: "CJ-7", tipo: "Preventiva" }, [c], AGORA)).toHaveLength(0);
    expect(sugerirDuplicidade({ cidade: "BH", conjunto: "CJ-7" }, [c], AGORA)).toHaveLength(0);
  });

  it("mesma rua sozinha não basta, mas é sinalizada quando há outro motivo", () => {
    const c = { ...base, lat: null, lng: null, transformador: null, uc: null };
    expect(sugerirDuplicidade({ cidade: "BH", endereco: "rua a, 10" }, [c], AGORA)).toEqual([]);
    const r = sugerirDuplicidade({ cidade: "BH", endereco: "RUA Á, 10", uc: "1000001" }, [{ ...c, uc: "1000001" }], AGORA);
    expect(r[0]!.mesmoEndereco).toBe(true);
  });

  it("ignora outra cidade, OS fechadas e OS fora da janela de 24 h", () => {
    const cands = [
      { ...base, id: "a", numero: "A", cidade: "CT" },
      { ...base, id: "b", numero: "B", status: "Concluída" },
      { ...base, id: "c", numero: "C", status: "Cancelada" },
      { ...base, id: "d", numero: "D", abertaEmMs: AGORA - 25 * H },
      { ...base, id: "e", numero: "E", abertaEmMs: AGORA - 24 * H },
    ];
    expect(sugerirDuplicidade(q, cands, AGORA).map((s) => s.id)).toEqual(["e"]);
  });

  it("parâmetros configuráveis (raio e janela)", () => {
    const c = { ...base, lat: base.lat! + 0.0045 }; // ~500 m
    expect(sugerirDuplicidade(q, [c], AGORA)).toEqual([]);
    expect(sugerirDuplicidade(q, [c], AGORA, { raioM: 600, janelaH: 24 })).toHaveLength(1);
  });

  it("ordena por distância (mais perto primeiro)", () => {
    const a = { ...base, id: "a", numero: "A", lat: base.lat! + 0.002 };
    const b = { ...base, id: "b", numero: "B", lat: base.lat! + 0.001 };
    expect(sugerirDuplicidade(q, [a, b], AGORA).map((s) => s.id)).toEqual(["b", "a"]);
  });
});

describe("OS demonstrativas", () => {
  it("são 11 (8 em BH, 3 em CT) e todas passam pelo motor e pelo schema de POST /os", () => {
    expect(OS_DEMO).toHaveLength(11);
    expect(OS_DEMO.filter((o) => o.cidade === "BH")).toHaveLength(8);
    for (const o of OS_DEMO) {
      const { fatos, tipo, prazoH, abertaMinAtras, cidade, endereco, transformador, uc } = o;
      expect(NovaOSSchema.safeParse({ cidade, endereco, transformador, uc, tipo, prazoH, fatos }).success).toBe(true);
      expect(validarFatos(fatos, VERSAO_DEMO)).toEqual([]);
      const agora = Date.now();
      const r = calcularPrioridade({ ...fatos, tipo, ...fatosAutomaticos({ aberturaMs: agora - abertaMinAtras * 60_000, prazoH }, agora) }, VERSAO_DEMO, REGRAS_DEMO);
      expect(r.codigo).toBeGreaterThanOrEqual(0);
    }
  });

  it("resultados esperados do protótipo", () => {
    const calc = (endereco: string) => {
      const o = OS_DEMO.find((x) => x.endereco === endereco)!;
      const agora = Date.now();
      return calcularPrioridade({ ...o.fatos, tipo: o.tipo, ...fatosAutomaticos({ aberturaMs: agora - o.abertaMinAtras * 60_000, prazoH: o.prazoH }, agora) }, VERSAO_DEMO, REGRAS_DEMO);
    };
    expect(calc("Clínica Boa Vida")).toMatchObject({ codigo: 0, nivel: 2 });
    expect(calc("Hospital Santa Luz")).toMatchObject({ codigo: 0, nivel: 2 });
    expect(calc("Av. Central, 900")).toMatchObject({ nivel: 3 });
    expect(calc("R. do Poste, 15").regrasAplicadas).toEqual(["R-EST"]);
    expect(calc("Subestação Norte").regrasAplicadas).toEqual(["R-PREV"]);
    expect(calc("R. Sul, 77").nivel).toBe(0);
  });

  it("coordenadas preservam as distâncias do protótipo (1 un = 20 m)", () => {
    const centro = { lat: -19.9167, lng: -43.9345 };
    const a = coordenadaDemo(centro, 30, 35);
    const b = coordenadaDemo(centro, 33, 38);
    expect(Math.round(distanciaM(a, b))).toBeCloseTo(Math.hypot(3, 3) * 20, -1);
    const c = coordenadaDemo(centro, 50, 50);
    expect(c.lat).toBeCloseTo(centro.lat, 9);
    expect(c.lng).toBeCloseTo(centro.lng, 9);
  });
});
