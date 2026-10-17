"use client";

import CheckCircleOutline from "@mui/icons-material/CheckCircleOutlineOutlined";
import Restore from "@mui/icons-material/Restore";
import type { EstadoPontuacao, VersaoResumo } from "@farol/shared";
import { MODO_PUBLICACAO } from "@/lib/escopo";
import { dataHora } from "@/lib/format";
import { EstadoVazio } from "@/components/estados";
import { Icone } from "@/components/icone";
import { Tabela } from "@/components/tabela";

interface Props {
  estado: EstadoPontuacao;
  podeEditar: boolean;
  podeAprovar: boolean;
  atorId: string;
  ocupado: boolean;
  onRestaurar: (v: VersaoResumo) => void;
  onAprovar: (v: VersaoResumo) => void;
}

function situacao(v: VersaoResumo): string {
  if (v.status === "aguardando_aprovacao") return "Aguardando aprovação";
  if (v.vigente) return "Vigente";
  if (v.agendada) return "Agendada";
  return "Substituída";
}

/** Histórico de versões do escopo (publicadas e aguardando aprovação), com Restaurar e Aprovar. */
export function Versoes({ estado, podeEditar, podeAprovar, atorId, ocupado, onRestaurar, onAprovar }: Props) {
  if (estado.historico.length === 0) return <EstadoVazio>Este escopo ainda não tem versão publicada.</EstadoVazio>;
  const comRascunho = !!estado.rascunho;
  return (
    <>
      {podeEditar && comRascunho && (
        <p id="versoes-restaurar-bloqueio" className="text-muted">Já existe um rascunho: publique ou descarte antes de restaurar uma versão.</p>
      )}
      <Tabela legenda="Versões de pontuação">
        <thead>
          <tr>
            <th scope="col">Versão</th><th scope="col">Situação</th><th scope="col">Vigência</th><th scope="col">Modo</th><th scope="col">Justificativa</th>
            <th scope="col">Publicada por</th><th scope="col">Aprovada por</th><th scope="col"><span className="sr-only">Ações</span></th>
          </tr>
        </thead>
        <tbody>
          {estado.historico.map((v) => (
            <tr key={v.id} className="data-table__row--interactive">
              <td className="data-table__cell--num">v{v.numero}{v.restauradaDe != null && <span className="text-muted"> (de v{v.restauradaDe})</span>}</td>
              <td>{situacao(v)}</td>
              <td className="data-table__cell--num">{v.vigenciaInicio ? dataHora(v.vigenciaInicio) : "—"}</td>
              <td>{v.modo ? MODO_PUBLICACAO[v.modo] : "—"}</td>
              <td className="data-table__cell--wrap">{v.justificativa ?? "—"}</td>
              <td>{v.autor ?? "—"}</td>
              <td>{v.aprovadoPor ?? "—"}</td>
              <td className="data-table__cell--actions">
                {v.status === "publicada" && podeEditar && (
                  <button
                    type="button"
                    className="button button--sm"
                    onClick={() => onRestaurar(v)}
                    disabled={ocupado || comRascunho}
                    aria-label={`Restaurar a v${v.numero} como novo rascunho`}
                    aria-describedby={comRascunho ? "versoes-restaurar-bloqueio" : undefined}
                  >
                    <Icone de={Restore} />Restaurar
                  </button>
                )}
                {v.status === "aguardando_aprovacao" && podeAprovar && (
                  v.autorId === atorId ? (
                    <span className="text-muted">Você enviou esta versão: outra pessoa precisa aprovar.</span>
                  ) : (
                    <button type="button" className="button button--primary button--sm" onClick={() => onAprovar(v)} disabled={ocupado} aria-label={`Aprovar e publicar a v${v.numero}`}>
                      <Icone de={CheckCircleOutline} />Aprovar e publicar
                    </button>
                  )
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </Tabela>
    </>
  );
}
