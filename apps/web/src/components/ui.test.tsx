// Prova a infraestrutura de teste de componentes (jsdom + Testing Library) usando componentes que já existem; não os altera.
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ApiError } from "@/lib/api";
import { Carregando, ErroAcao, ErroApi, Pill } from "./ui";

describe("componentes de ui (infraestrutura de teste)", () => {
  it("Carregando é uma região de status com o texto", () => {
    render(<Carregando texto="Carregando o mapa…" />);
    expect(screen.getByRole("status")).toBeTruthy();
    expect(screen.getByText("Carregando o mapa…")).toBeTruthy();
  });
  it("Pill mostra o nome da prioridade", () => {
    render(<Pill codigo={1} />);
    expect(screen.getByText("Urgente")).toBeTruthy();
  });
  it("ErroApi 403 é um alerta sem botão de tentar de novo", () => {
    render(<ErroApi erro={new ApiError(403, "Sem permissão")} titulo="Falhou." onRetry={() => {}} />);
    expect(screen.getByRole("alert").textContent).toMatch(/403/);
    expect(screen.queryByText("Tentar novamente")).toBeNull();
  });
  it("ErroApi de rede oferece tentar novamente", () => {
    render(<ErroApi erro={new ApiError(0, "sem rede")} titulo="Falhou." onRetry={() => {}} />);
    expect(screen.getByText("Tentar novamente")).toBeTruthy();
  });
  it("ErroAcao mostra o código HTTP e a mensagem da regra", () => {
    render(<ErroAcao erro={new ApiError(409, "Sugestão já registrada")} />);
    expect(screen.getByRole("alert").textContent).toBe("409 — Sugestão já registrada");
  });
});
