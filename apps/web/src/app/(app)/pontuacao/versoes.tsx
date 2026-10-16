"use client";

import type { EstadoPontuacao, VersaoResumo } from "@farol/shared";
import { dataHora } from "@/lib/format";

interface Props {
  estado: EstadoPontuacao;
  podeEditar: boolean;
  podeAprovar: boolean;
  atorId: string;
  ocupado: boolean;
  onRestaurar: (v: VersaoResumo) => void;
  onAprovar: (v: VersaoResumo) => void;
}

const MODO = { novas: "Somente novas OS", reclassificar: "Reclassifica as OS abertas" } as const;

function situacao(v: VersaoResumo): string {
  if (v.status === "aguardando_aprovacao") return "Aguardando aprovação";
  if (v.vigente) return "Vigente";
  if (v.agendada) return "Agendada";
  return "Substituída";
}

/** Histórico de versões do escopo (publicadas e aguardando aprovação), com Restaurar e Aprovar. */
export function Versoes({ estado, podeEditar, podeAprovar, atorId, ocupado, onRestaurar, onAprovar }: Props) {
  if (estado.historico.length === 0) return <p className="mu">Este escopo ainda não tem versão publicada.</p>;
  return (
    <div className="tw">
      <table className="tabela">
        <thead>
          <tr><th>Versão</th><th>Situação</th><th>Vigência</th><th>Modo</th><th>Justificativa</th><th>Publicada por</th><th>Aprovada por</th><th /></tr>
        </thead>
        <tbody>
          {estado.historico.map((v) => (
            <tr key={v.id} className="r">
              <td className="m">v{v.numero}{v.restauradaDe != null && <span className="mu"> (de v{v.restauradaDe})</span>}</td>
              <td>{situacao(v)}</td>
              <td className="m">{v.vigenciaInicio ? dataHora(v.vigenciaInicio) : "—"}</td>
              <td>{v.modo ? MODO[v.modo] : "—"}</td>
              <td className="max-w-[320px] whitespace-normal">{v.justificativa ?? "—"}</td>
              <td>{v.autor ?? "—"}</td>
              <td>{v.aprovadoPor ?? "—"}</td>
              <td>
                {v.status === "publicada" && podeEditar && (
                  <button
                    onClick={() => onRestaurar(v)}
                    disabled={ocupado || !!estado.rascunho}
                    title={estado.rascunho ? "Já existe um rascunho: publique ou descarte antes de restaurar." : "Cria um novo rascunho a partir desta versão"}
                  >
                    Restaurar como novo rascunho
                  </button>
                )}
                {v.status === "aguardando_aprovacao" && podeAprovar && (
                  v.autorId === atorId ? (
                    <span className="mu">Você enviou esta versão: outra pessoa precisa aprovar.</span>
                  ) : (
                    <button className="btn-pr" onClick={() => onAprovar(v)} disabled={ocupado}>Aprovar e publicar</button>
                  )
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
