"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { nomeDaCidade, notaEquipeCampo } from "@/lib/escopo";
import { minutosDesde, prazoTexto } from "@/lib/format";
import type { OSFila } from "@/lib/types";
import { CabecalhoPagina } from "@/components/cabecalho-pagina";
import { EstadoConsulta, EstadoVazio, SemCidade } from "@/components/estados";
import { Pill } from "@/components/prioridade";
import { Tabela } from "@/components/tabela";
import { useApp } from "../app-context";

export default function FilaPage() {
  const { ator, cidades, cidade } = useApp();
  const nome = nomeDaCidade(cidade, cidades);

  const fila = useQuery({
    queryKey: ["fila", cidade],
    queryFn: () => api<OSFila[]>(`/os/fila?cidade=${encodeURIComponent(cidade)}`),
    enabled: cidade !== "",
    refetchInterval: 60_000, // a API reclassifica a cada 60 s (§7)
  });

  if (cidade === "") return <SemCidade />;

  return (
    <>
      <CabecalhoPagina
        titulo={`Fila — ${nome}`}
        descricao={<>
          Ordem: precedência, código, corretiva antes de preventiva, pontos, prazo, abertura, nº da OS. Posição calculada dentro da cidade da OS.
          {notaEquipeCampo(ator) && <> {notaEquipeCampo(ator)}</>}
        </>}
      />
      <EstadoConsulta consulta={fila} carregando="Carregando a fila…" erro="Não foi possível carregar a fila.">
        {(lista) => lista.length ? (
          <Tabela legenda={`Fila de OS — ${nome}`}>
            <thead>
              <tr>
                <th scope="col">Pos.</th><th scope="col">OS</th><th scope="col">Cidade</th><th scope="col">Prioridade</th><th scope="col">Nível</th>
                <th scope="col">Pontos</th><th scope="col">Tipo</th><th scope="col">Prazo</th><th scope="col">Aberta há</th><th scope="col">Status</th><th scope="col">Endereço</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((o) => (
                <tr key={o.id} className="data-table__row--interactive">
                  <td className="data-table__cell--num">{o.posicao}</td>
                  <td><Link href={`/os/${o.id}`} className="link link--chip">{o.numero}</Link></td>
                  <td>{o.cidade_id}</td>
                  <td><Pill codigo={o.codigo} /></td>
                  <td className="data-table__cell--num">{o.nivel}</td>
                  <td className="data-table__cell--num">{o.pontos}</td>
                  <td>{o.tipo}</td>
                  <td className="data-table__cell--num">{prazoTexto(o.prazo_limite)}</td>
                  <td className="data-table__cell--num">{minutosDesde(o.aberta_em)} min</td>
                  <td>{o.status}</td>
                  <td>{o.endereco}</td>
                </tr>
              ))}
            </tbody>
          </Tabela>
        ) : (
          <EstadoVazio>Nenhuma OS aberta nesta visão. Registre uma solicitação em <b>Nova solicitação</b> ou troque de cidade.</EstadoVazio>
        )}
      </EstadoConsulta>
    </>
  );
}
