"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import type { DetalheOS, ResultadoDetalhe } from "@farol/shared";
import { api } from "@/lib/api";
import { dataHora } from "@/lib/format";
import { Carregando, ErroApi, Pill } from "@/components/ui";
import { useApp } from "../../app-context";

const ABAS = ["Prioridade", "Histórico"] as const;
type Aba = (typeof ABAS)[number];

function Prioridade({ r, d, cidadeNome }: { r: ResultadoDetalhe; d: DetalheOS; cidadeNome: string }) {
  return (
    <>
      <p>
        <Pill codigo={r.codigo} /> nível <b className="m">{r.nivel}</b> · <b className="m">{r.pontos}</b> pts · faixa:{" "}
        <Pill codigo={r.codigoFaixa} /> · versão <b>v{r.versao}</b>
        {d.os.posicao != null && <> · posição <b className="m">{d.os.posicao}</b> em {cidadeNome}</>}
      </p>
      <p><b>Motivo principal:</b> {r.motivoPrincipal}</p>
      <p>
        <b>Regras de precedência aplicadas:</b>{" "}
        {r.regrasAplicadas.length ? r.regrasAplicadas.map((x) => x.nome).join("; ") : "nenhuma"}
      </p>
      <p className="mu">Motivo do cálculo: {r.motivoCalculo} · {dataHora(r.calculadoEm)}</p>
      <div className="tw">
        <table className="tabela">
          <thead><tr><th>Critério</th><th>Valor</th><th>Pontos</th></tr></thead>
          <tbody>
            {r.itens.map((i) => (
              <tr key={i.criterio}>
                <td>{i.criterio}</td>
                <td>
                  {i.opcoes.length ? i.opcoes.join(", ") : "—"}
                  {i.requerConfirmacao && <span className="mu"> (requer confirmação)</span>}
                </td>
                <td className="m">{i.pontos}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function Historico({ h }: { h: ResultadoDetalhe[] }) {
  return (
    <>
      <h3>Resultados de prioridade (imutáveis)</h3>
      <div className="tw">
        <table className="tabela">
          <thead><tr><th>Hora</th><th>Código</th><th>Pontos</th><th>Nível</th><th>Versão</th><th>Motivo do cálculo</th></tr></thead>
          <tbody>
            {h.map((x) => (
              <tr key={x.id}>
                <td className="m">{dataHora(x.calculadoEm)}</td>
                <td><Pill codigo={x.codigo} /></td>
                <td className="m">{x.pontos}</td>
                <td className="m">{x.nivel}</td>
                <td>v{x.versao}</td>
                <td>{x.motivoCalculo}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

export default function DetalhePage() {
  const { id } = useParams<{ id: string }>();
  const { cidades } = useApp();
  const [aba, setAba] = useState<Aba>("Prioridade");

  const q = useQuery({ queryKey: ["os", id], queryFn: () => api<DetalheOS>(`/os/${encodeURIComponent(id)}`), refetchInterval: 60_000 });
  const d = q.data;

  return (
    <>
      <Link href="/fila" className="inline-block rounded-[3px] border border-ln bg-p2 px-[7px] py-1">← Voltar à fila</Link>
      {q.isPending ? (
        <Carregando texto="Carregando a OS…" />
      ) : q.isError ? (
        <ErroApi erro={q.error} titulo="Não foi possível carregar a OS." onRetry={() => q.refetch()} />
      ) : d && (
        <>
          <h2 className="m mt-2">
            {d.os.numero} <span className="mu font-normal">{d.os.endereco}</span>
          </h2>
          <p className="mu">
            {d.os.tipo} · {d.os.status}
            {d.os.transformador && <> · trafo <span className="m">{d.os.transformador}</span></>}
            {d.os.uc && <> · UC <span className="m">{d.os.uc}</span></>}
          </p>
          <div className="tabs" role="tablist">
            {ABAS.map((t) => (
              <button key={t} role="tab" aria-selected={aba === t} onClick={() => setAba(t)}>{t}</button>
            ))}
          </div>
          <div className="box">
            {!d.resultado ? (
              <p className="mu">Esta OS ainda não tem resultado de prioridade calculado.</p>
            ) : aba === "Prioridade" ? (
              <Prioridade r={d.resultado} d={d} cidadeNome={cidades.find((c) => c.id === d.os.cidade)?.nome ?? d.os.cidade} />
            ) : (
              <Historico h={d.historico} />
            )}
          </div>
        </>
      )}
    </>
  );
}
