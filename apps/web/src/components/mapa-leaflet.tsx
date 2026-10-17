"use client";

import "leaflet/dist/leaflet.css";
import { useEffect, useState } from "react";
import { Circle, CircleMarker, MapContainer, Polyline, TileLayer, Tooltip, useMap, useMapEvents } from "react-leaflet";
import { CODIGOS, coordenadaDoClique, distanciasAteEquipes, temPonto, type EquipeMapa, type OSMapa } from "@farol/shared";
import { formatarMetros } from "@/lib/format";

export interface MapaProps {
  os: OSMapa[];
  equipes: EquipeMapa[];
  mostrarEquipes: boolean;
  selecionadaId: string | null;
  /** raio de duplicidade (m), vindo da API */
  raioM: number;
  centro: { lat: number; lng: number } | null;
  /** muda quando o mapa deve reenquadrar (ex.: troca de cidade); atualizações de dados não reenquadram */
  chave: string;
  rotulo: string;
  /** px ou qualquer medida CSS (ex.: `max(560px, calc(100dvh - 150px))`) */
  altura?: number | string;
  onSelecionar?: (id: string) => void;
  /** modo "escolher o ponto": clique no mapa devolve latitude/longitude já normalizadas */
  onClicar?: (p: { lat: number; lng: number }) => void;
  /** ponto escolhido (modo escolher): ganha um marcador e o círculo do raio de duplicidade */
  ponto?: { lat: number; lng: number } | null;
}

const BRASIL: [number, number] = [-14.235, -51.925];
/** Tokens de src/styles/tokens.css lidos em runtime; a ordem das prioridades segue CODIGOS (0 = mais urgente). */
const PRIORIDADES = ["--color-priority-emergente", "--color-priority-urgente", "--color-priority-alta", "--color-priority-media", "--color-priority-baixa"] as const;
const TELA = [...PRIORIDADES, "--color-primary", "--color-text-muted", "--color-map-team", "--color-map-marker-stroke"] as const;

/** Cores do tema atual (o Leaflet não resolve `var()` em atributos SVG); relê quando o tema alterna. */
function useCores(): Record<string, string> {
  const [c, setC] = useState<Record<string, string>>({});
  useEffect(() => {
    const ler = () => {
      const s = getComputedStyle(document.documentElement);
      setC(Object.fromEntries(TELA.map((k) => [k, s.getPropertyValue(k).trim()])));
    };
    ler();
    const mo = new MutationObserver(ler);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-t"] });
    return () => mo.disconnect();
  }, []);
  return c;
}

/** Enquadra os pontos ao montar e quando `chave` muda. Não reage às atualizações de 60 s, para não tirar o usuário de onde está. */
function Ajustar({ chave, pontos, centro }: { chave: string; pontos: [number, number][]; centro: MapaProps["centro"] }) {
  const map = useMap();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- reenquadrar só quando a chave muda
  useEffect(() => {
    if (pontos.length > 1) map.fitBounds(pontos, { padding: [30, 30], maxZoom: 16 });
    else if (pontos.length === 1) map.setView(pontos[0]!, 16);
    else if (centro) map.setView([centro.lat, centro.lng], 13);
    else map.setView(BRASIL, 4);
  }, [chave]);
  return null;
}

function Cliques({ onClicar }: { onClicar: (p: { lat: number; lng: number }) => void }) {
  useMapEvents({
    click(e) {
      const p = coordenadaDoClique(e.latlng.lat, e.latlng.lng);
      if (p) onClicar(p);
    },
  });
  return null;
}

/** Leva o mapa ao ponto digitado quando ele sai da área visível. */
function Seguir({ ponto }: { ponto: { lat: number; lng: number } | null | undefined }) {
  const map = useMap();
  useEffect(() => {
    if (ponto && !map.getBounds().contains([ponto.lat, ponto.lng])) map.panTo([ponto.lat, ponto.lng]);
  }, [map, ponto]);
  return null;
}

export function MapaLeaflet({ os, equipes, mostrarEquipes, selecionadaId, raioM, centro, chave, rotulo, altura = 440, onSelecionar, onClicar, ponto }: MapaProps) {
  const cor = useCores();
  const sel = os.find((o) => o.id === selecionadaId) ?? null;
  const comPonto = os.filter(temPonto);
  const eqComPonto = equipes.filter(temPonto);
  const pontos: [number, number][] = [
    ...comPonto.map((o): [number, number] => [o.lat, o.lng]),
    ...(mostrarEquipes ? eqComPonto.map((e): [number, number] => [e.lat, e.lng]) : []),
  ];
  const ac = cor["--color-primary"] || "currentColor";
  const contorno = cor["--color-map-marker-stroke"] || "currentColor";
  const inicio = pontos[0] ?? (centro ? ([centro.lat, centro.lng] as [number, number]) : BRASIL);
  const ligacoes = sel && temPonto(sel) && mostrarEquipes ? distanciasAteEquipes(sel, eqComPonto) : [];

  return (
    // A altura vem de quem usa (px ou expressão CSS): é dado, não tema; por isso é o único estilo em linha.
    <div role="region" aria-label={rotulo} className="map-view__canvas" style={{ height: altura }}>
      <MapContainer
        center={inicio}
        zoom={13}
        className={onClicar ? "map-view__leaflet map-view__leaflet--pick" : "map-view__leaflet"}
        scrollWheelZoom
      >
        <TileLayer
          url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
          maxZoom={19}
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">OpenStreetMap</a> contributors'
        />
        <Ajustar chave={chave} pontos={pontos} centro={centro} />
        {onClicar && <Cliques onClicar={onClicar} />}
        <Seguir ponto={ponto} />

        {sel && temPonto(sel) && (
          <Circle center={[sel.lat, sel.lng]} radius={raioM} pathOptions={{ color: ac, fill: false, dashArray: "6 4", weight: 2 }} />
        )}
        {ligacoes.map((l) =>
          l.distanciaM != null && temPonto(l.equipe) && sel && temPonto(sel) ? (
            <Polyline key={l.equipe.id} positions={[[sel.lat, sel.lng], [l.equipe.lat, l.equipe.lng]]} pathOptions={{ color: cor["--color-text-muted"] || "currentColor", dashArray: "2 6", weight: 1.5 }}>
              <Tooltip sticky>{l.equipe.id}: {formatarMetros(l.distanciaM)} em linha reta</Tooltip>
            </Polyline>
          ) : null,
        )}
        {mostrarEquipes && eqComPonto.map((e) => (
          <CircleMarker key={e.id} center={[e.lat, e.lng]} radius={7} pathOptions={{ color: contorno, weight: 2, fillColor: cor["--color-map-team"] || "currentColor", fillOpacity: 1 }}>
            <Tooltip permanent direction="right" offset={[8, 0]}>{e.id} {e.emUso}/{e.capacidade}</Tooltip>
          </CircleMarker>
        ))}
        {comPonto.map((o) => (
          <CircleMarker
            key={o.id}
            center={[o.lat, o.lng]}
            radius={o.id === selecionadaId ? 12 : 9}
            pathOptions={{ color: contorno, weight: 2, fillColor: cor[PRIORIDADES[o.codigo] ?? ""] || "currentColor", fillOpacity: 1 }}
            eventHandlers={onSelecionar ? { click: () => onSelecionar(o.id) } : undefined}
          >
            <Tooltip>{o.num} · {CODIGOS[o.codigo] ?? `Código ${o.codigo}`}{onSelecionar ? " — clique para abrir a rota no Maps" : ""}</Tooltip>
          </CircleMarker>
        ))}
        {ponto && (
          <>
            <Circle center={[ponto.lat, ponto.lng]} radius={raioM} pathOptions={{ color: ac, fill: false, dashArray: "6 4", weight: 1.5 }} />
            <CircleMarker center={[ponto.lat, ponto.lng]} radius={8} pathOptions={{ color: contorno, weight: 2, fillColor: ac, fillOpacity: 1 }}>
              <Tooltip permanent direction="top">Local escolhido</Tooltip>
            </CircleMarker>
          </>
        )}
      </MapContainer>
    </div>
  );
}
