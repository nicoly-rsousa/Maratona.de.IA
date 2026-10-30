import { AVISO_SEM_CIRCUITO, estiloDaPrioridade } from "@/lib/rede";
import type { OSRedeLeve } from "@/lib/rede-api";

/** OS cujo circuito não foi identificado: ficam no mapa (anel vazado) E aqui, com o aviso. Nada é corrigido automaticamente. */
export function ListaSemCircuito({
  os, selecionada, onVerNoMapa,
}: { os: readonly OSRedeLeve[]; selecionada: string | null; onVerNoMapa: (numero: string) => void }) {
  return (
    <section id="lista-sem-circuito" className="box" aria-labelledby="sem-circuito-titulo">
      <h3 id="sem-circuito-titulo" style={{ marginTop: 0 }}>
        OS sem alimentador identificado ({os.length.toLocaleString("pt-BR")})
      </h3>
      <div className="warn" role="note">{AVISO_SEM_CIRCUITO}</div>
      {os.length === 0 ? (
        <p className="mu">Nenhuma OS com alimentador não identificado nesta carga.</p>
      ) : (
        <div className="tw" style={{ maxHeight: 320, overflow: "auto" }}>
          <table className="tabela">
            <caption className="sr-only">OS com alimentador não identificado</caption>
            <thead>
              <tr>
                <th scope="col">OS</th>
                <th scope="col">Alimentador informado</th>
                <th scope="col">Município</th>
                <th scope="col">Prioridade legada</th>
                <th scope="col"><span className="sr-only">Ação</span></th>
              </tr>
            </thead>
            <tbody>
              {os.map((o) => (
                <tr key={o.numero} className="r" aria-selected={o.numero === selecionada}>
                  <td className="m">{o.numero}</td>
                  <td className="m">{o.circuito ?? "(vazio)"}</td>
                  <td>{o.municipio ?? "—"}</td>
                  <td>{o.prioridade_legada ?? "—"} <span className="mu">({estiloDaPrioridade(o.prioridade_codigo).rotulo})</span></td>
                  <td>
                    <button type="button" onClick={() => onVerNoMapa(o.numero)} aria-label={`Ver a OS ${o.numero} no mapa`}>Ver no mapa</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
