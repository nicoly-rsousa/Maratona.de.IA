import { AVISO_SEM_CIRCUITO, estiloDaPrioridade, semCircuitoIdentificado } from "@/lib/rede";
import type { OSRedeLeve } from "@/lib/rede-api";
import { dataHora } from "@/lib/format";

/**
 * Detalhe da OS clicada no mapa ou escolhida na lista. A classe é INFORMATIVA (prioridade legada mapeada).
 * `circuitoAbrivel`: o código informado numa OS de circuito NÃO identificado, quando ele existe na lista de circuitos.
 * Abrir é uma ação explícita do usuário; nada é corrigido nem aberto automaticamente.
 */
export function DetalheOS({ os, circuitoAbrivel = null, onAbrirCircuito, semCaixa = false }: {
  os: OSRedeLeve | null;
  circuitoAbrivel?: string | null;
  onAbrirCircuito?: (codigo: string) => void;
  semCaixa?: boolean;
}) {
  if (!os) return <section className="box" aria-live="polite"><p className="mu" style={{ margin: 0 }}>Clique numa OS no mapa para ver os detalhes.</p></section>;
  const e = estiloDaPrioridade(os.prioridade_codigo);
  const semCirc = semCircuitoIdentificado([os]).length > 0;
  return (
    <section className={semCaixa ? undefined : "box"} aria-live="polite" aria-labelledby={semCaixa ? undefined : "detalhe-os-titulo"}>
      {!semCaixa && <h3 id="detalhe-os-titulo" style={{ marginTop: 0 }}><span className="m">{os.numero}</span></h3>}
      <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "2px 10px" }}>
        <dt className="mu">Prioridade legada</dt>
        <dd style={{ margin: 0 }}>{os.prioridade_legada ?? "—"}</dd>
        <dt className="mu">Classe (informativa)</dt>
        <dd style={{ margin: 0 }}>{e.rotulo}{e.semMapa ? " — a prioridade legada não está no mapa" : ""}</dd>
        <dt className="mu">Alimentador</dt>
        <dd style={{ margin: 0 }} className="m">{os.circuito ?? "(vazio)"}</dd>
        <dt className="mu">Município</dt>
        <dd style={{ margin: 0 }}>{os.municipio ?? "—"}</dd>
        <dt className="mu">Prazo</dt>
        <dd style={{ margin: 0 }}>{os.prazo ? dataHora(os.prazo) : "—"}</dd>
        <dt className="mu">Serviço</dt>
        <dd style={{ margin: 0 }}>{os.tipo_servico ?? "—"}</dd>
      </dl>
      {semCirc && <div className="warn" role="note">{AVISO_SEM_CIRCUITO}</div>}
      {semCirc && circuitoAbrivel && onAbrirCircuito && (
        <button type="button" onClick={() => onAbrirCircuito(circuitoAbrivel)}>Abrir o alimentador informado ({circuitoAbrivel})</button>
      )}
    </section>
  );
}
