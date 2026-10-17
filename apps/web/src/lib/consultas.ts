import { queryOptions } from "@tanstack/react-query";
import type { RespostaMapa } from "@farol/shared";
import { api } from "./api";
import type { Sugestao } from "./types";

/** Consultas usadas por mais de uma tela: mesma chave = mesmo cache (e mesma invalidação). */

export const consultaMapa = (cidade: string) =>
  queryOptions({
    queryKey: ["mapa", cidade],
    queryFn: () => api<RespostaMapa>(`/mapa?cidade=${encodeURIComponent(cidade)}`),
  });

/** `qs` = parâmetros já montados da busca de duplicidade (§11). */
export const consultaDuplicidade = (qs: string) =>
  queryOptions({
    queryKey: ["duplicidade", qs],
    queryFn: () => api<Sugestao[]>(`/os/duplicidade?${qs}`),
    staleTime: 0,
  });
