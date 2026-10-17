"use client";

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import CheckCircle from "@mui/icons-material/CheckCircle";
import DirectionsOutlined from "@mui/icons-material/DirectionsOutlined";
import { distanciasAteEquipes, ordenarOSMapa, osNoRaio, temPonto, urlMapas, type OSMapa, type RespostaMapa } from "@farol/shared";
import { consultaMapa } from "@/lib/consultas";
import { nomeDaCidade, notaEquipeCampo } from "@/lib/escopo";
import { formatarMetros } from "@/lib/format";
import { Alerta } from "@/components/alerta";
import { CabecalhoPagina } from "@/components/cabecalho-pagina";
import { CampoCheckbox } from "@/components/campo";
import { EstadoConsulta, EstadoVazio, SemCidade } from "@/components/estados";
import { Icone } from "@/components/icone";
import { LinkExterno } from "@/components/link-externo";
import { Mapa } from "@/components/mapa";
import { Pill } from "@/components/prioridade";
import { useApp } from "../app-context";

function Detalhe({ sel, d, mostrarEquipes }: { sel: OSMapa; d: RespostaMapa; mostrarEquipes: boolean }) {
  const dist = distanciasAteEquipes(sel, d.equipes);
  const vizinhas = osNoRaio(sel, d.os.filter((o) => o.cidade === sel.cidade), d.raioM);
  return (
    <section className="card" aria-label={`OS selecionada ${sel.num}`}>
      <div className="card__header">
        <Link href={`/os/${sel.id}`} className="link link--mono">{sel.num}</Link>
        <Pill codigo={sel.codigo} />
      </div>
      <p className="text-muted">{sel.tipo} · {sel.status} · nível <span className="font-mono">{sel.nivel}</span></p>
      {temPonto(sel) ? (
        <div>
          <LinkExterno href={urlMapas({ lat: sel.lat, lng: sel.lng })} className="button button--sm"><Icone de={DirectionsOutlined} />Navegar até a OS no Maps</LinkExterno>
        </div>
      ) : (
        <Alerta tipo="warning">Sem coordenadas: <b>localização aproximada</b>. Esta OS não aparece no mapa até alguém informar o local.</Alerta>
      )}
      {sel.status === "Em triagem" && (
        <Alerta tipo="warning">OS <b>Em triagem</b>: o local ainda não foi confirmado{temPonto(sel) ? "; a posição no mapa pode estar errada" : ""}.</Alerta>
      )}
      {mostrarEquipes && temPonto(sel) && (
        <>
          <h3 className="page__section-title">Equipes <span className="page__section-hint">(distância em linha reta)</span></h3>
          {dist.length === 0 ? (
            <p className="text-muted">Nenhuma equipe ativa nesta cidade.</p>
          ) : (
            <ul className="map-view__teams">
              {dist.map((x) => (
                <li key={x.equipe.id}>
                  {x.equipe.id}: {x.distanciaM != null ? formatarMetros(x.distanciaM) : "sem posição"}{" "}
                  <span className="text-muted">({x.equipe.emUso}/{x.equipe.capacidade} em uso)</span>
                </li>
              ))}
            </ul>
          )}
          <p className="text-muted">Linha reta, sem rota nem tempo estimado.</p>
        </>
      )}
      {temPonto(sel) && (
        <p>
          Outras OS dentro de {d.raioM} m:{" "}
          <span className="font-mono">{vizinhas.length ? vizinhas.map((o) => o.num).join(", ") : "nenhuma"}</span>
        </p>
      )}
    </section>
  );
}

export default function MapaPage() {
  const { ator, cidades, cidade } = useApp();
  const nome = nomeDaCidade(cidade, cidades);
  const [selId, setSelId] = useState<string | null>(null);
  const [mostrarEquipes, setMostrarEquipes] = useState(true);

  // Clique no ponto do mapa: seleciona a OS e abre a rota no Google Maps (origem = posição atual do usuário, calculada pelo Maps).
  function abrirRota(o: OSMapa) {
    setSelId(o.id);
    if (temPonto(o)) window.open(urlMapas({ lat: o.lat, lng: o.lng }), "_blank", "noopener,noreferrer");
  }

  const q = useQuery({
    ...consultaMapa(cidade),
    enabled: cidade !== "",
    refetchInterval: 60_000, // a API reclassifica a cada 60 s (§7)
  });

  if (cidade === "") return <SemCidade />;

  return (
    <>
      <CabecalhoPagina
        titulo={`Mapa — ${nome}`}
        descricao={<>
          Cor e rótulo = prioridade. <b>Clique num ponto do mapa para abrir a rota no Google Maps.</b> Selecione uma OS na lista para ver o raio de
          duplicidade e a distância em <b>linha reta</b> até as equipes, sem rota nem tempo.
          {notaEquipeCampo(ator) && <> {notaEquipeCampo(ator)}</>}
        </>}
      />
      <EstadoConsulta consulta={q} carregando="Carregando o mapa…" erro="Não foi possível carregar o mapa.">
        {(d) => {
          const lista = ordenarOSMapa(d.os);
          const sel = d.os.find((o) => o.id === selId) ?? null;
          const noMapa = d.os.filter(temPonto).length;
          return (
            <div className="map-view">
              <div className="flex min-w-0 flex-col gap-2">
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
                  altura="max(480px, calc(100dvh - 240px))"
                />
                {d.os.length === 0 && <p className="text-muted" role="status">Sem OS abertas nesta cidade.</p>}
              </div>
              <aside className="map-view__aside" aria-label="Detalhes e lista de OS">
                <CampoCheckbox rotulo={`Mostrar equipes (${d.equipes.length})`} checked={mostrarEquipes} onChange={setMostrarEquipes} />
                <div className="map-view__legend" role="list" aria-label="Legenda das prioridades">
                  {[0, 1, 2, 3, 4].map((k) => <span key={k} role="listitem"><Pill codigo={k} bloco /></span>)}
                </div>
                {sel ? <Detalhe sel={sel} d={d} mostrarEquipes={mostrarEquipes} /> : <div className="card card--muted">Selecione uma OS no mapa ou na lista.</div>}

                <h2 className="page__section-title">OS no mapa <span className="page__section-hint">({noMapa} de {d.os.length} com localização)</span></h2>
                {lista.length === 0 ? (
                  <EstadoVazio>Sem OS abertas nesta cidade.</EstadoVazio>
                ) : (
                  <ul className="map-view__list" aria-label="OS no mapa">
                    {lista.map((o) => {
                      const selecionada = o.id === sel?.id;
                      return (
                        <li key={o.id} className="map-view__item">
                          <button
                            type="button"
                            className={selecionada ? "button button--sm button--selected font-mono" : "button button--sm font-mono"}
                            aria-pressed={selecionada}
                            onClick={() => setSelId(o.id)}
                          >
                            {selecionada && <Icone de={CheckCircle} />}{o.num}
                          </button>
                          <Pill codigo={o.codigo} />
                          {!temPonto(o) && <span className="map-view__item-note">sem local</span>}
                          {o.status === "Em triagem" && <span className="map-view__item-note">em triagem</span>}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </aside>
            </div>
          );
        }}
      </EstadoConsulta>
    </>
  );
}
