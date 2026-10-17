import { describe, expect, it } from "vitest";
import { textoCondicoes } from "./index";

describe("texto das condições de uma regra", () => {
  it("junta as condições com E e as opções com /", () => {
    expect(
      textoCondicoes([
        { criterio: "essencial", criterioNome: "Serviço essencial", opcoes: ["Hospital / emergência"] },
        { criterio: "reserva", criterioNome: "Fonte de reserva", opcoes: ["Não", "Desconhecida"] },
      ]),
    ).toBe("Serviço essencial ∈ Hospital / emergência E Fonte de reserva ∈ Não/Desconhecida");
  });
});
