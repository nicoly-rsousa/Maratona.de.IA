import { AVISO_SEM_CIRCUITO, estiloDaPrioridade, semCircuitoIdentificado } from "@/lib/rede";
import type { OSRedeLeve } from "@/lib/rede-api";
import { dataHora } from "@/lib/format";

/** Detalhe da OS clicada no mapa ou escolhida na lista. A classe é INFORMATIVA (prioridade legada mapeada). */
export function DetalheOS({ os }: { os: OSRedeLeve | null }) {
  if (!os) return <section className="box" aria-live="polite"><p className="mu" style={{ margin: 0 }}>Clique numa OS no mapa para ver os detalhes.</p></section>;
  const e = estiloDaPrioridade(os.prioridade_codigo);
  const semCirc = semCircuitoIdentificado([os]).length > 0;
  return (
    <section className="box" aria-live="polite" aria-labelledby="detalhe-os-titulo">
      <h3 id="detalhe-os-titulo" style={{ marginTop: 0 }}><span className="m">{os.numero}</span></h3>
      <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 10px" }}>
        <dt className="mu">Prioridade legada</dt>
        <dd style={{ margin: 0 }}>{os.prioridade_legada ?? "—"}</dd>
        <dt className="mu">Classe (informativa)</dt>
        <dd style={{ margin: 0 }}>{e.rotulo}{e.semMapa ? " — a prioridade legada não está no mapa" : ""}</dd>
        <dt className="mu">Circuito</dt>
        <dd style={{ margin: 0 }} className="m">{os.circuito ?? "(vazio)"}</dd>
        <dt className="mu">Município</dt>
        <dd style={{ margin: 0 }}>{os.municipio ?? "—"}</dd>
        <dt className="mu">Prazo</dt>
        <dd style={{ margin: 0 }}>{os.prazo ? dataHora(os.prazo) : "—"}</dd>
        <dt className="mu">Serviço</dt>
        <dd style={{ margin: 0 }}>{os.tipo_servico ?? "—"}</dd>
      </dl>
      {semCirc && <div className="warn" role="note">{AVISO_SEM_CIRCUITO}</div>}
    </section>
  );
}
