"use client";

import { useMemo, useState } from "react";
import { osProximas, RAIO_OS_PROXIMAS_M, temCoordenada } from "@/lib/rede-mapa";
import type { OSRedeLeve } from "@/lib/rede-api";
import { DetalheOS } from "./detalhe-os";

type Aba = "informacoes" | "proximas";

const textoDistancia = (metros: number) => metros >= 1_000
  ? `${(metros / 1_000).toLocaleString("pt-BR", { maximumFractionDigits: 2 })} km`
  : `${Math.round(metros).toLocaleString("pt-BR")} m`;

/** Painel com as informações da OS e as outras OS no raio de 1 km. */
export function PainelOSProximas({
  os, todas, circuitoAbrivel = null, onAbrirCircuito, onVerNoMapa,
}: {
  os: OSRedeLeve | null;
  todas: readonly OSRedeLeve[];
  circuitoAbrivel?: string | null;
  onAbrirCircuito?: (codigo: string) => void;
  onVerNoMapa: (numero: string) => void;
}) {
  const [aba, setAba] = useState<Aba>("informacoes");
  const proximas = useMemo(() => (os ? osProximas(os, todas) : []), [os, todas]);

  if (!os) return <DetalheOS os={null} />;

  return (
    <section className="box" aria-labelledby="detalhe-os-titulo">
      <h3 id="detalhe-os-titulo" style={{ marginTop: 0 }}><span className="m">{os.numero}</span></h3>
      <div className="tabs" role="tablist" aria-label="Detalhes da OS selecionada">
        <button
          id="aba-informacoes" type="button" role="tab" aria-selected={aba === "informacoes"}
          aria-controls="painel-informacoes" onClick={() => setAba("informacoes")}
        >Informações</button>
        <button
          id="aba-proximas" type="button" role="tab" aria-selected={aba === "proximas"}
          aria-controls="painel-proximas" onClick={() => setAba("proximas")}
        >OS próximas ({proximas.length})</button>
      </div>

      {aba === "informacoes" ? (
        <div id="painel-informacoes" role="tabpanel" aria-labelledby="aba-informacoes">
          <DetalheOS os={os} circuitoAbrivel={circuitoAbrivel} onAbrirCircuito={onAbrirCircuito} semCaixa />
        </div>
      ) : (
        <div id="painel-proximas" role="tabpanel" aria-labelledby="aba-proximas">
          <p className="mu" style={{ marginTop: 0 }}>
            OS em linha reta em até {(RAIO_OS_PROXIMAS_M / 1_000).toLocaleString("pt-BR")} km. O círculo tracejado no mapa usa o mesmo raio.
          </p>
          {!temCoordenada(os) ? (
            <p className="warn" role="note">Esta OS não tem coordenada válida; não é possível calcular OS próximas.</p>
          ) : proximas.length === 0 ? (
            <p className="mu">Nenhuma outra OS dentro de 1 km.</p>
          ) : (
            <ul className="lista-os-proximas" aria-label="OS próximas em até 1 km">
              {proximas.map(({ os: proxima, distanciaM }) => (
                <li key={proxima.numero}>
                  <button type="button" className="m" onClick={() => onVerNoMapa(proxima.numero)} aria-label={`Ver a OS ${proxima.numero} no mapa`}>
                    {proxima.numero}
                  </button>
                  <span>{textoDistancia(distanciaM)}</span>
                  <span className="mu">{proxima.prioridade_legada ?? "Sem prioridade legada"}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
