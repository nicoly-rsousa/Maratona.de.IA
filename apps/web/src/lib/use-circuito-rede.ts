"use client";

import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { chavesRede, redeApi, type Chaves, type CircuitoResumo, type DetalheCircuito, type Tracado, type TransformadorRede } from "./rede-api";
import { CACHE_OS_MS } from "./rede";

export interface EstadoConsulta<T> {
  dados: T | undefined;
  /** buscando pela primeira vez (consulta desabilitada NÃO conta como carregando) */
  carregando: boolean;
  erro: unknown;
  refazer: () => void;
}

export const estadoDa = <T,>(q: UseQueryResult<T>): EstadoConsulta<T> => ({ dados: q.data, carregando: q.isLoading, erro: q.error, refazer: () => void q.refetch() });

/**
 * Dados do circuito SELECIONADO e só dele. Nada é pedido sem seleção; e o que o circuito não tem (segundo a lista) nem é pedido:
 *  - traçado só se `tem_tracado`; a baixa tensão (?bt=1) só depois que o usuário liga a caixa;
 *  - chaves só se `chaves_qtd > 0`;
 *  - transformadores e detalhe sempre (o circuito pode existir só na base de clientes, como "CET-LUM 2").
 */
export function useCircuitoRede(codigo: string | null, item: CircuitoResumo | undefined, baixaTensao: boolean) {
  const base = codigo !== null && item !== undefined; // espera a lista dizer o que o circuito tem
  const cod = codigo ?? "";
  const temTracado = base && item.tem_tracado;
  const temChaves = base && (item.chaves_qtd ?? 0) > 0;

  const detalhe = useQuery<DetalheCircuito>({ queryKey: chavesRede.circuito(cod), queryFn: () => redeApi.circuito(cod), enabled: base, staleTime: CACHE_OS_MS });
  const mediaTensao = useQuery<Tracado>({ queryKey: chavesRede.tracado(cod, false), queryFn: () => redeApi.tracado(cod, false), enabled: temTracado, staleTime: CACHE_OS_MS });
  const comBaixaTensao = useQuery<Tracado>({ queryKey: chavesRede.tracado(cod, true), queryFn: () => redeApi.tracado(cod, true), enabled: temTracado && baixaTensao, staleTime: CACHE_OS_MS });
  const chaves = useQuery<Chaves>({ queryKey: chavesRede.chaves(cod), queryFn: () => redeApi.chaves(cod), enabled: temChaves, staleTime: CACHE_OS_MS });
  const transformadores = useQuery<TransformadorRede[]>({ queryKey: chavesRede.transformadores(cod), queryFn: () => redeApi.transformadores(cod), enabled: base, staleTime: CACHE_OS_MS });

  return { detalhe, mediaTensao, comBaixaTensao, chaves, transformadores };
}
