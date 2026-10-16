"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { distanciasAteEquipes, ordenarOSMapa, osNoRaio, temPonto, urlMapas, type OSMapa, type RespostaMapa } from "@farol/shared";
import { api } from "@/lib/api";
import { Carregando, ErroApi, Pill } from "@/components/ui";
import { Mapa } from "@/components/mapa";
import { useApp } from "../app-context";

function Detalhe({ sel, d, mostrarEquipes }: { sel: OSMapa; d: RespostaMapa; mostrarEquipes: boolean }) {
  const dist = distanciasAteEquipes(sel, d.equipes);
  const vizinhas = osNoRaio(sel, d.os.filter((o) => o.cidade === sel.cidade), d.raioM);
  return (
    <div className="box">
      <Link href={`/os/${sel.id}`} className="m text-ac underline">{sel.num}</Link> <Pill codigo={sel.codigo} />
      <div className="mu">{sel.tipo} · {sel.status} · nível <span className="m">{sel.nivel}</span></div>
      {temPonto(sel) && (
        <p>
          <a className="bt" href={urlMapas({ lat: sel.lat, lng: sel.lng })} target="_blank" rel="noopener noreferrer">Navegar até a OS no Maps</a>
        </p>
      )}
      {!temPonto(sel) && (
        <div className="warn">Sem coordenadas: <b>localização aproximada</b>. Esta OS não aparece no mapa até alguém informar o local.</div>
      )}
      {sel.status === "Em triagem" && (
        <div className="warn">OS <b>Em triagem</b>: o local ainda não foi confirmado{temPonto(sel) ? "; a posição no mapa pode estar errada" : ""}.</div>
      )}
      {mostrarEquipes && temPonto(sel) && (
        <>
          <h3>Equipes (distância em linha reta)</h3>
          {dist.length === 0 ? (
            <p className="mu">Nenhuma equipe ativa nesta cidade.</p>
          ) : (
            <ul className="m m-0 list-none p-0">
              {dist.map((x) => (
                <li key={x.equipe.id}>
                  {x.equipe.id}: {x.distanciaM != null ? `${x.distanciaM} m` : "sem posição"}{" "}
                  <span className="mu">({x.equipe.emUso}/{x.equipe.capacidade} em uso)</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mu">Linha reta, sem rota nem tempo estimado.</p>
        </>
      )}
      {temPonto(sel) && (
        <div>
          Outras OS dentro de {d.raioM} m:{" "}
          <span className="m">{vizinhas.length ? vizinhas.map((o) => o.num).join(", ") : "nenhuma"}</span>
        </div>
      )}
    </div>
  );
}

export default function MapaPage() {
  const { ator, cidades, cidade } = useApp();
  const nome = cidade === "*" ? "todas as cidades" : (cidades.find((c) => c.id === cidade)?.nome ?? cidade);
  const [selId, setSelId] = useState<string | null>(null);
  const [mostrarEquipes, setMostrarEquipes] = useState(true);

  // Clique no ponto do mapa: seleciona a OS e abre a rota no Google Maps (origem = posição atual do usuário, calculada pelo Maps).
  function abrirRota(o: OSMapa) {
    setSelId(o.id);
    if (temPonto(o)) window.open(urlMapas({ lat: o.lat, lng: o.lng }), "_blank", "noopener,noreferrer");
  }

  const q = useQuery({
    queryKey: ["mapa", cidade],
    queryFn: () => api<RespostaMapa>(`/mapa?cidade=${encodeURIComponent(cidade)}`),
    enabled: cidade !== "",
    refetchInterval: 60_000, // a API reclassifica a cada 60 s (§7)
  });

  if (cidade === "") {
    return <div className="warn">Seu usuário não tem cidade vinculada. Peça a um administrador para vinculá-lo a um município.</div>;
  }

  const d = q.data;
  const lista = d ? ordenarOSMapa(d.os) : [];
  const sel = d?.os.find((o) => o.id === selId) ?? null;
  const noMapa = d ? d.os.filter(temPonto).length : 0;

  return (
    <>
      <h2>Mapa — {nome}</h2>
      {q.isPending ? (
        <Carregando texto="Carregando o mapa…" />
      ) : q.isError ? (
        <ErroApi erro={q.error} titulo="Não foi possível carregar o mapa." onRetry={() => q.refetch()} />
      ) : d && (
        <>
          <p className="mu">
            Cor = prioridade. <b>Clique num ponto do mapa para abrir a rota no Google Maps.</b> Selecione uma OS na lista para ver o raio de {d.raioM} m (duplicidade) e a distância em{" "}
            <b>linha reta</b> até as equipes, sem rota nem tempo.
            {ator.perfil === "Equipe de campo" && <> Você vê só as OS da sua equipe ({ator.equipeId ?? "sem equipe"}).</>}
          </p>
          <div className="row" style={{ alignItems: "start" }}>
            <div style={{ flex: "1 1 560px", minWidth: 0 }}>
              <Mapa
                os={d.os}
                equipes={d.equipes}
                mostrarEquipes={mostrarEquipes}
                selecionadaId={sel?.id ?? null}
                raioM={d.raioM}
                centro={d.centro}
                chave={cidade}
                rotulo={`Mapa de ${nome}`}
                onSelecionar={(id) => { const o = d.os.find((x) => x.id === id); if (o) abrirRota(o); }}
                altura="max(560px, calc(100dvh - 170px))"
              />
              {d.os.length === 0 && <p className="mu" role="status">Sem OS abertas nesta cidade.</p>}
            </div>
            <aside style={{ flex: "0 1 290px", minWidth: 0 }} aria-label="Detalhes e lista de OS">
              <label className="mb-1 flex items-center gap-1">
                <input type="checkbox" checked={mostrarEquipes} onChange={(e) => setMostrarEquipes(e.target.checked)} />
                Mostrar equipes ({d.equipes.length})
              </label>
              <div className="mb-1" aria-label="Legenda das prioridades">
                {[0, 1, 2, 3, 4].map((k) => <span key={k} className="mr-1 inline-block"><Pill codigo={k} /></span>)}
              </div>
              {sel ? <Detalhe sel={sel} d={d} mostrarEquipes={mostrarEquipes} /> : <div className="box mu">Selecione uma OS no mapa ou na lista.</div>}

              <h3>OS no mapa <span className="mu font-normal">({noMapa} de {d.os.length} com localização)</span></h3>
              {lista.length === 0 ? (
                <p className="mu">Sem OS abertas nesta cidade.</p>
              ) : (
                <ul className="m-0 list-none p-0" aria-label="OS no mapa">
                  {lista.map((o) => (
                    <li key={o.id} className="mb-[2px]">
                      <button
                        type="button"
                        className="m"
                        aria-pressed={o.id === sel?.id}
                        onClick={() => setSelId(o.id)}
                        style={o.id === sel?.id ? { borderColor: "var(--ac)" } : undefined}
                      >
                        {o.num}
                      </button>{" "}
                      <Pill codigo={o.codigo} />
                      {!temPonto(o) && <span className="mu"> · sem local</span>}
                      {o.status === "Em triagem" && <span className="mu"> · em triagem</span>}
                    </li>
                  ))}
                </ul>
              )}
            </aside>
          </div>
        </>
      )}
    </>
  );
}
