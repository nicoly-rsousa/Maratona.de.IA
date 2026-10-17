"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import ArrowBack from "@mui/icons-material/ArrowBack";
import type { DetalheOS } from "@farol/shared";
import { api } from "@/lib/api";
import { nomeDaCidade } from "@/lib/escopo";
import { Abas } from "@/components/abas";
import { CabecalhoPagina } from "@/components/cabecalho-pagina";
import { ErroApi } from "@/components/alerta";
import { Carregando } from "@/components/estados";
import { Icone } from "@/components/icone";
import { useApp } from "../../app-context";
import { DespachoAba } from "./despacho-aba";
import { HistoricoAba } from "./historico-aba";
import { PrioridadeAba } from "./prioridade-aba";
import { StatusAba } from "./status-aba";

const ABAS = ["Prioridade", "Despacho", "Status", "Histórico"] as const;
type Aba = (typeof ABAS)[number];

const voltar = <Link href="/fila" className="link link--back"><Icone de={ArrowBack} />Voltar à fila</Link>;

export default function DetalhePage() {
  const { id } = useParams<{ id: string }>();
  const { ator, cidades } = useApp();
  const [aba, setAba] = useState<Aba>("Prioridade");
  // O Usuário Chave configura a pontuação e não vê o despacho (§13); a API também não o envia a ele.
  const veDespacho = ator.perfil !== "Usuário Chave";
  const abas: readonly Aba[] = veDespacho ? ABAS : ABAS.filter((t) => t !== "Despacho");

  const q = useQuery({ queryKey: ["os", id], queryFn: () => api<DetalheOS>(`/os/${encodeURIComponent(id)}`), refetchInterval: 60_000 });

  if (q.isPending) return <><div>{voltar}</div><Carregando texto="Carregando a OS…" /></>;
  if (q.isError) return <><div>{voltar}</div><ErroApi erro={q.error} titulo="Não foi possível carregar a OS." onRetry={() => q.refetch()} /></>;
  const d = q.data;

  return (
    <>
      <CabecalhoPagina
        antes={voltar}
        titulo={<><span className="font-mono">{d.os.numero}</span> <span className="font-normal text-muted">{d.os.endereco}</span></>}
        descricao={<>
          {d.os.tipo} · {d.os.status}
          {d.os.transformador && <> · trafo <span className="font-mono">{d.os.transformador}</span></>}
          {d.os.uc && <> · UC <span className="font-mono">{d.os.uc}</span></>}
          {d.os.exigeQualificacao && <> · exige <b>{d.os.exigeQualificacao}</b></>}
          {" · "}{d.solicitacoes.length} {d.solicitacoes.length === 1 ? "solicitação" : "solicitações"}
        </>}
      />
      <Abas abas={abas} ativa={aba} onMudar={setAba} rotulo="Seções da OS">
        {aba === "Despacho" ? (
          <DespachoAba d={d} ator={ator} />
        ) : aba === "Status" ? (
          <StatusAba d={d} ator={ator} />
        ) : aba === "Histórico" ? (
          <HistoricoAba d={d} comDespachos={veDespacho} />
        ) : !d.resultado ? (
          <p className="text-muted">Esta OS ainda não tem resultado de prioridade calculado.</p>
        ) : (
          <PrioridadeAba r={d.resultado} d={d} cidadeNome={nomeDaCidade(d.os.cidade, cidades)} />
        )}
      </Abas>
    </>
  );
}
