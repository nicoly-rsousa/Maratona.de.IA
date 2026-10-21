"use client";

import { createContext, useContext } from "react";
import type { Ator, Cidade } from "@/lib/types";

export interface AppState {
  ator: Ator;
  cidades: Cidade[];
  /** id da cidade selecionada ou "*" (todas, só com permissão). */
  cidade: string;
  setCidade: (id: string) => void;
  /** Código do alimentador; vazio = todos, valor reservado = OS sem alimentador identificado. */
  alimentador: string;
  setAlimentador: (codigo: string) => void;
}

export const SEM_ALIMENTADOR = "__sem_alimentador__";

const Ctx = createContext<AppState | null>(null);
export const AppProvider = Ctx.Provider;

export function useApp(): AppState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp fora do AppProvider");
  return v;
}
