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
import { DespachoAba } from "./despacho-aba";
import { StatusAba } from "./status-aba";

const ABAS = ["Prioridade", "Despacho", "Status", "Histórico"] as const;
type Aba = (typeof ABAS)[number];

const ESTADO: Record<string, string> = {
  designada: "Designada", a_caminho: "A caminho", em_execucao: "Em execução", concluida: "Concluída", removida: "Removida",
};
const TIPO_EVENTO: Record<string, string> = {
  status: "Status", designacao: "Designação", aceite: "Aceite", inicio: "Início", conclusao: "Conclusão", remocao: "Remoção de equipe",
};

function Eventos({ d, comDespachos }: { d: DetalheOS; comDespachos: boolean }) {
  return (
    <>
      {comDespachos && <h3>Despachos (o registro anterior é preservado)</h3>}
      {!comDespachos ? null : d.despachos.length === 0 ? (
        <p className="mu">Nenhum despacho.</p>
      ) : (
        <div className="tw">
          <table className="tabela">
            <thead>
              <tr><th>Equipe</th><th>Estado</th><th>Designada</th><th>A caminho</th><th>Em execução</th><th>Concluída</th><th>Removida</th><th>Motivo da remoção</th></tr>
            </thead>
            <tbody>
              {d.despachos.map((x) => (
                <tr key={x.id}>
                  <td><b>{x.equipe}</b>{x.apoioIntermunicipal && <span className="mu"> (apoio)</span>}</td>
                  <td>{ESTADO[x.estado] ?? x.estado}</td>
                  {[x.designadaEm, x.aCaminhoEm, x.emExecucaoEm, x.concluidaEm, x.removidaEm].map((t, k) => (
                    <td key={k} className="m">{t ? dataHora(t) : "—"}</td>
                  ))}
                  <td>{x.removidaMotivo ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <h3>Eventos</h3>
      {d.eventos.length === 0 ? (
        <p className="mu">Nenhum evento registrado.</p>
      ) : (
        d.eventos.map((e) => (
          <div key={e.id} className="mu m">
            {dataHora(e.em)} — {TIPO_EVENTO[e.tipo] ?? e.tipo}
            {e.equipe && <> {e.equipe}</>}
            {(e.de || e.para) && <>: {e.de ?? "—"} → {e.para ?? "—"}</>}
            {e.motivo && <>. Justificativa: {e.motivo}</>}
            {e.usuario && <> · por {e.usuario}</>}
          </div>
        ))
      )}
    </>
  );
}

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

function Solicitacoes({ s }: { s: DetalheOS["solicitacoes"] }) {
  return (
    <>
      <h3>Solicitações recebidas</h3>
      <div className="tw">
        <table className="tabela">
          <thead><tr><th>Hora</th><th>Origem</th><th>Endereço informado</th><th>Observação</th></tr></thead>
          <tbody>
            {s.map((x) => (
              <tr key={x.id}>
                <td className="m">{dataHora(x.criadoEm)}</td>
                <td>{x.origem === "abertura" ? "Abertura da OS" : "Vinculada"}</td>
                <td>{x.endereco ?? "—"}</td>
                <td>{x.observacao ?? "—"}</td>
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
  const { ator, cidades } = useApp();
  const [aba, setAba] = useState<Aba>("Prioridade");
  // O Usuário Chave configura a pontuação e não vê o despacho (§13); a API também não o envia a ele.
  const veDespacho = ator.perfil !== "Usuário Chave";
  const abas: readonly Aba[] = veDespacho ? ABAS : ABAS.filter((t) => t !== "Despacho");

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
            {d.os.exigeQualificacao && <> · exige <b>{d.os.exigeQualificacao}</b></>}
            {" · "}{d.solicitacoes.length} {d.solicitacoes.length === 1 ? "solicitação" : "solicitações"}
          </p>
          <div className="tabs" role="tablist" aria-label="Seções da OS">
            {abas.map((t) => (
              <button key={t} role="tab" id={`aba-${t}`} aria-selected={aba === t} aria-controls="painel-os" onClick={() => setAba(t)}>
                {t}
              </button>
            ))}
          </div>
          <div className="box" role="tabpanel" id="painel-os" aria-labelledby={`aba-${aba}`}>
            {aba === "Despacho" ? (
              <DespachoAba d={d} ator={ator} />
            ) : aba === "Status" ? (
              <StatusAba d={d} ator={ator} />
            ) : aba === "Histórico" ? (
              <>
                {d.resultado ? <Historico h={d.historico} /> : <p className="mu">Esta OS ainda não tem resultado de prioridade calculado.</p>}
                <Eventos d={d} comDespachos={veDespacho} />
                <Solicitacoes s={d.solicitacoes} />
              </>
            ) : !d.resultado ? (
              <p className="mu">Esta OS ainda não tem resultado de prioridade calculado.</p>
            ) : (
              <Prioridade r={d.resultado} d={d} cidadeNome={cidades.find((c) => c.id === d.os.cidade)?.nome ?? d.os.cidade} />
            )}
          </div>
        </>
      )}
    </>
  );
}
