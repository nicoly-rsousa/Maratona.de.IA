import type { DetalheOS, ResultadoDetalhe } from "@farol/shared";
import { dataHora } from "@/lib/format";
import { Pill } from "@/components/prioridade";
import { Tabela } from "@/components/tabela";

const ESTADO: Record<string, string> = {
  designada: "Designada", a_caminho: "A caminho", em_execucao: "Em execução", concluida: "Concluída", removida: "Removida",
};
const TIPO_EVENTO: Record<string, string> = {
  status: "Status", designacao: "Designação", aceite: "Aceite", inicio: "Início", conclusao: "Conclusão", remocao: "Remoção de equipe",
};

function Resultados({ h }: { h: ResultadoDetalhe[] }) {
  return (
    <section className="page__section">
      <h2 className="page__section-title">Resultados de prioridade <span className="page__section-hint">(imutáveis)</span></h2>
      <Tabela legenda="Resultados de prioridade">
        <thead><tr><th scope="col">Hora</th><th scope="col">Código</th><th scope="col">Pontos</th><th scope="col">Nível</th><th scope="col">Versão</th><th scope="col">Motivo do cálculo</th></tr></thead>
        <tbody>
          {h.map((x) => (
            <tr key={x.id}>
              <td className="data-table__cell--num">{dataHora(x.calculadoEm)}</td>
              <td><Pill codigo={x.codigo} /></td>
              <td className="data-table__cell--num">{x.pontos}</td>
              <td className="data-table__cell--num">{x.nivel}</td>
              <td>v{x.versao}</td>
              <td className="data-table__cell--wrap">{x.motivoCalculo}</td>
            </tr>
          ))}
        </tbody>
      </Tabela>
    </section>
  );
}

function Despachos({ d }: { d: DetalheOS }) {
  return (
    <section className="page__section">
      <h2 className="page__section-title">Despachos <span className="page__section-hint">(o registro anterior é preservado)</span></h2>
      {d.despachos.length === 0 ? (
        <p className="text-muted">Nenhum despacho.</p>
      ) : (
        <Tabela legenda="Despachos">
          <thead>
            <tr>
              <th scope="col">Equipe</th><th scope="col">Estado</th><th scope="col">Designada</th><th scope="col">A caminho</th>
              <th scope="col">Em execução</th><th scope="col">Concluída</th><th scope="col">Removida</th><th scope="col">Motivo da remoção</th>
            </tr>
          </thead>
          <tbody>
            {d.despachos.map((x) => (
              <tr key={x.id}>
                <td><b>{x.equipe}</b>{x.apoioIntermunicipal && <span className="text-muted"> (apoio)</span>}</td>
                <td>{ESTADO[x.estado] ?? x.estado}</td>
                {[x.designadaEm, x.aCaminhoEm, x.emExecucaoEm, x.concluidaEm, x.removidaEm].map((t, k) => (
                  <td key={k} className="data-table__cell--num">{t ? dataHora(t) : "—"}</td>
                ))}
                <td className="data-table__cell--wrap">{x.removidaMotivo ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </Tabela>
      )}
    </section>
  );
}

function Eventos({ eventos }: { eventos: DetalheOS["eventos"] }) {
  return (
    <section className="page__section">
      <h2 className="page__section-title">Eventos</h2>
      {eventos.length === 0 ? (
        <p className="text-muted">Nenhum evento registrado.</p>
      ) : (
        <ol className="timeline">
          {eventos.map((e) => (
            <li key={e.id} className="timeline__item">
              <time className="timeline__time" dateTime={e.em}>{dataHora(e.em)}</time>
              <b>{TIPO_EVENTO[e.tipo] ?? e.tipo}</b>
              {e.equipe && <> {e.equipe}</>}
              {(e.de || e.para) && <>: {e.de ?? "—"} → {e.para ?? "—"}</>}
              {e.motivo && <>. Justificativa: {e.motivo}</>}
              {e.usuario && <span className="text-muted"> · por {e.usuario}</span>}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Solicitacoes({ s }: { s: DetalheOS["solicitacoes"] }) {
  return (
    <section className="page__section">
      <h2 className="page__section-title">Solicitações recebidas</h2>
      <Tabela legenda="Solicitações recebidas">
        <thead><tr><th scope="col">Hora</th><th scope="col">Origem</th><th scope="col">Endereço informado</th><th scope="col">Observação</th></tr></thead>
        <tbody>
          {s.map((x) => (
            <tr key={x.id}>
              <td className="data-table__cell--num">{dataHora(x.criadoEm)}</td>
              <td>{x.origem === "abertura" ? "Abertura da OS" : "Vinculada"}</td>
              <td className="data-table__cell--wrap">{x.endereco ?? "—"}</td>
              <td className="data-table__cell--wrap">{x.observacao ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </Tabela>
    </section>
  );
}

/** Histórico da OS: resultados de prioridade, despachos (se o perfil vê despacho), eventos e solicitações. */
export function HistoricoAba({ d, comDespachos }: { d: DetalheOS; comDespachos: boolean }) {
  return (
    <>
      {d.resultado ? <Resultados h={d.historico} /> : <p className="text-muted">Esta OS ainda não tem resultado de prioridade calculado.</p>}
      {comDespachos && <Despachos d={d} />}
      <Eventos eventos={d.eventos} />
      <Solicitacoes s={d.solicitacoes} />
    </>
  );
}
