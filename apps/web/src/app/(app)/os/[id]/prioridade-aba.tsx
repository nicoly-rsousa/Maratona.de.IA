import type { DetalheOS, ResultadoDetalhe } from "@farol/shared";
import { dataHora } from "@/lib/format";
import { Pill } from "@/components/prioridade";
import { Tabela } from "@/components/tabela";

/** Resultado de prioridade vigente: resumo, motivo, regras de precedência e pontos por critério. */
export function PrioridadeAba({ r, d, cidadeNome }: { r: ResultadoDetalhe; d: DetalheOS; cidadeNome: string }) {
  return (
    <>
      <dl className="summary">
        <div className="summary__item"><dt className="summary__label">Prioridade</dt><dd className="summary__value"><Pill codigo={r.codigo} /></dd></div>
        <div className="summary__item"><dt className="summary__label">Nível</dt><dd className="summary__value font-mono">{r.nivel}</dd></div>
        <div className="summary__item"><dt className="summary__label">Pontos</dt><dd className="summary__value font-mono">{r.pontos}</dd></div>
        <div className="summary__item"><dt className="summary__label">Faixa</dt><dd className="summary__value"><Pill codigo={r.codigoFaixa} /></dd></div>
        <div className="summary__item"><dt className="summary__label">Versão</dt><dd className="summary__value">v{r.versao}</dd></div>
        {d.os.posicao != null && (
          <div className="summary__item"><dt className="summary__label">Posição em {cidadeNome}</dt><dd className="summary__value font-mono">{d.os.posicao}</dd></div>
        )}
      </dl>
      <p><b>Motivo principal:</b> {r.motivoPrincipal}</p>
      <p>
        <b>Regras de precedência aplicadas:</b>{" "}
        {r.regrasAplicadas.length ? r.regrasAplicadas.map((x) => x.nome).join("; ") : "nenhuma"}
      </p>
      <p className="text-muted">Motivo do cálculo: {r.motivoCalculo} · {dataHora(r.calculadoEm)}</p>
      <Tabela legenda="Pontos por critério">
        <thead><tr><th scope="col">Critério</th><th scope="col">Valor</th><th scope="col">Pontos</th></tr></thead>
        <tbody>
          {r.itens.map((i) => (
            <tr key={i.criterio}>
              <td>{i.criterio}</td>
              <td className="data-table__cell--wrap">
                {i.opcoes.length ? i.opcoes.join(", ") : "—"}
                {i.requerConfirmacao && <span className="text-muted"> (requer confirmação)</span>}
              </td>
              <td className="data-table__cell--num">{i.pontos}</td>
            </tr>
          ))}
        </tbody>
      </Tabela>
    </>
  );
}
