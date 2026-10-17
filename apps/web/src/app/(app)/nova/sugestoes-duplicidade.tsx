"use client";

import Link from "@mui/icons-material/Link";
import type { MotivoDuplicidade } from "@farol/shared";
import { formatarMetros, minutosDesde } from "@/lib/format";
import type { Sugestao } from "@/lib/types";
import { Alerta } from "@/components/alerta";
import { CampoFormulario } from "@/components/campo";
import { Icone } from "@/components/icone";
import { LinkExterno } from "@/components/link-externo";
import { Pill } from "@/components/prioridade";
import { Tabela } from "@/components/tabela";

const MOTIVO: Record<MotivoDuplicidade, string> = {
  proximidade: "próxima",
  mesmo_transformador: "mesmo transformador",
  mesma_uc: "mesma UC",
  mesmo_conjunto_e_tipo: "mesmo conjunto e tipo",
};

interface Props {
  sugestoes: Sugestao[];
  ocupado: boolean;
  observacao: string;
  onObservacao: (v: string) => void;
  onVincular: (osId: string) => void;
}

/** Possíveis duplicidades (§11): sugestão, nunca automática. O atendente vincula a uma OS existente ou cria uma nova. */
export function SugestoesDuplicidade({ sugestoes, ocupado, observacao, onObservacao, onVincular }: Props) {
  return (
    <Alerta tipo="warning" role="alert" titulo="Possível duplicidade (sugestão, nunca automática)">
      <p>OS abertas da mesma cidade nas últimas horas. Vincule a solicitação a uma delas ou confirme que é uma OS nova.</p>
      <div className="flex flex-col gap-3">
        <Tabela legenda="OS possivelmente duplicadas">
          <thead>
            <tr>
              <th scope="col">OS</th><th scope="col">Prioridade</th><th scope="col">Endereço</th><th scope="col">Semelhança</th>
              <th scope="col">Situação</th><th scope="col"><span className="sr-only">Ação</span></th>
            </tr>
          </thead>
          <tbody>
            {sugestoes.map((s) => (
              <tr key={s.id}>
                <td><LinkExterno href={`/os/${s.id}`} className="link link--mono">{s.numero}</LinkExterno></td>
                <td><Pill codigo={s.codigo} /></td>
                <td className="data-table__cell--wrap">{s.endereco}</td>
                <td>
                  {s.distanciaM != null && `${formatarMetros(s.distanciaM)} · `}{s.motivos.map((m) => MOTIVO[m]).join(", ")}
                  {s.mesmoEndereco && " · mesmo endereço"}
                </td>
                <td>{s.status} · há {minutosDesde(new Date(s.abertaEmMs).toISOString())} min</td>
                <td className="data-table__cell--actions">
                  <button type="button" className="button button--sm" disabled={ocupado} onClick={() => onVincular(s.id)} aria-label={`Vincular a solicitação à ${s.numero}`}>
                    <Icone de={Link} />Vincular
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </Tabela>
        <CampoFormulario id="n_obs" rotulo="Observação para o vínculo" dica="Opcional, até 500 caracteres.">
          {(a) => <input {...a} className="control" value={observacao} maxLength={500} onChange={(e) => onObservacao(e.target.value)} />}
        </CampoFormulario>
      </div>
    </Alerta>
  );
}
