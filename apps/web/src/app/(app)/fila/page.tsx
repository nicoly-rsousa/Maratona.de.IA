"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { minutosDesde, prazoTexto } from "@/lib/format";
import type { OSFila } from "@/lib/types";
import { Carregando, ErroApi, Pill } from "@/components/ui";
import { useApp } from "../app-context";

export default function FilaPage() {
  const { cidades, cidade } = useApp();
  const nome = cidade === "*" ? "todas as cidades" : (cidades.find((c) => c.id === cidade)?.nome ?? cidade);

  const fila = useQuery({
    queryKey: ["fila", cidade],
    queryFn: () => api<OSFila[]>(`/os/fila?cidade=${encodeURIComponent(cidade)}`),
    enabled: cidade !== "",
    refetchInterval: 60_000, // a API reclassifica a cada 60 s (§7)
  });

  if (cidade === "") {
    return <div className="warn">Seu usuário não tem cidade vinculada. Peça a um administrador para vinculá-lo a um município.</div>;
  }

  const lista = fila.data ?? [];

  return (
    <>
      <h2>Fila — {nome}</h2>
      {fila.isPending ? (
        <Carregando texto="Carregando a fila…" />
      ) : fila.isError ? (
        <ErroApi erro={fila.error} titulo="Não foi possível carregar a fila." onRetry={() => fila.refetch()} />
      ) : (
        <>
          <p className="mu">
            Ordem: precedência, código, corretiva antes de preventiva, pontos, prazo, abertura, nº da OS. Posição calculada dentro da cidade da OS.
          </p>
          {lista.length ? (
            <div className="tw">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Pos.</th><th>OS</th><th>Cidade</th><th>Prioridade</th><th>Nível</th><th>Pontos</th>
                    <th>Tipo</th><th>Prazo</th><th>Aberta há</th><th>Status</th><th>Endereço</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.map((o) => (
                    <tr key={o.id} className="r">
                      <td className="m">{o.posicao}</td>
                      <td><Link href={`/os/${o.id}`} className="m text-ac underline">{o.numero}</Link></td>
                      <td>{o.cidade_id}</td>
                      <td><Pill codigo={o.codigo} /></td>
                      <td className="m">{o.nivel}</td>
                      <td className="m">{o.pontos}</td>
                      <td>{o.tipo}</td>
                      <td className="m">{prazoTexto(o.prazo_limite)}</td>
                      <td className="m">{minutosDesde(o.aberta_em)} min</td>
                      <td>{o.status}</td>
                      <td>{o.endereco}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="box">Nenhuma OS aberta nesta visão. Troque de cidade ou aguarde novas solicitações.</div>
          )}
        </>
      )}
    </>
  );
}
