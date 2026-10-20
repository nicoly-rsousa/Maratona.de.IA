"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import { fundoAtual } from "@/lib/fundos-mapa";
import type { OSRedeLeve } from "@/lib/rede-api";
import { CORES_DO_TEMA, CORES_RESERVA, estiloDoPonto, limitesDasOS, temCoordenada, textoDoPonto, type CoresTema, type EstiloPonto } from "@/lib/rede-mapa";

export interface MapaRedeProps {
  os: OSRedeLeve[];
  selecionada: string | null;
  onSelecionar: (numero: string) => void;
  /** pedido de foco vindo da lista: `n` muda a cada pedido, para repetir o mesmo número */
  foco: { numero: string; n: number } | null;
  rotulo: string;
  /** px ou medida CSS */
  altura?: number | string;
}

const BRASIL: [number, number] = [-14.235, -51.925];

/** EstiloPonto → opções do Leaflet (dashArray ausente = contorno contínuo). */
const opcoes = (e: EstiloPonto): L.CircleMarkerOptions => ({ ...e, dashArray: e.dashArray ?? undefined });

/** Cores do tema atual (o canvas não resolve var()); relê quando o tema alterna (atributo data-t). */
function useCoresTema(): CoresTema {
  const [c, setC] = useState<CoresTema>(CORES_RESERVA);
  useEffect(() => {
    const ler = () => {
      const s = getComputedStyle(document.documentElement);
      setC(Object.fromEntries(CORES_DO_TEMA.map((k) => [k, s.getPropertyValue(k).trim()])));
    };
    ler();
    const mo = new MutationObserver(ler);
    mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-t"] });
    return () => mo.disconnect();
  }, []);
  return c;
}

const reduzirMovimento = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;

/**
 * UMA camada imperativa para as OS (não um componente React por ponto): os marcadores são criados uma vez por conjunto de dados,
 * desenhados no canvas do mapa, com um único tooltip compartilhado. Seleção e troca de tema só restilizam o necessário.
 */
function CamadaOS({ os, selecionada, onSelecionar, foco }: Pick<MapaRedeProps, "os" | "selecionada" | "onSelecionar" | "foco">) {
  const map = useMap();
  const cores = useCoresTema();
  const marcadores = useRef(new Map<string, { m: L.CircleMarker; o: OSRedeLeve }>());
  const tooltip = useRef<L.Tooltip | null>(null);
  const jaEnquadrou = useRef(false);
  const aoSelecionar = useRef(onSelecionar);
  const coresAtuais = useRef(cores);
  const selecionadaAtual = useRef<string | null>(selecionada);
  aoSelecionar.current = onSelecionar;
  coresAtuais.current = cores;

  // (re)cria a camada quando o conjunto de dados muda
  useEffect(() => {
    const grupo = L.featureGroup();
    const novos = new Map<string, { m: L.CircleMarker; o: OSRedeLeve }>();
    for (const o of os) {
      if (!temCoordenada(o)) continue;
      const m = L.circleMarker([o.lat, o.lng], opcoes(estiloDoPonto(o, coresAtuais.current, o.numero === selecionadaAtual.current)));
      m.on("click", () => aoSelecionar.current(o.numero));
      m.on("mouseover", (e: L.LeafletMouseEvent) => {
        tooltip.current ??= L.tooltip({ direction: "top", offset: [0, -6] });
        // textContent: o número da OS e a prioridade vêm de planilha importada; nunca interpretar como HTML
        const el = document.createElement("div");
        el.textContent = textoDoPonto(o);
        tooltip.current.setContent(el).setLatLng(e.latlng);
        if (!map.hasLayer(tooltip.current)) tooltip.current.addTo(map);
      });
      m.on("mouseout", () => { tooltip.current?.remove(); });
      grupo.addLayer(m);
      novos.set(o.numero, { m, o });
    }
    grupo.addTo(map);
    marcadores.current = novos;
    if (!jaEnquadrou.current) {
      const lim = limitesDasOS(os);
      if (lim) { map.fitBounds(lim, { padding: [30, 30], maxZoom: 16 }); jaEnquadrou.current = true; }
    }
    return () => { tooltip.current?.remove(); grupo.remove(); marcadores.current = new Map(); };
  }, [map, os]);

  const restilizar = (numero: string | null) => {
    const x = numero ? marcadores.current.get(numero) : undefined;
    if (!x) return;
    x.m.setStyle(opcoes(estiloDoPonto(x.o, coresAtuais.current, numero === selecionadaAtual.current)));
  };

  // troca de tema: restiliza todos (o desenho em canvas é agrupado pelo Leaflet)
  useEffect(() => {
    marcadores.current.forEach(({ m, o }) => {
      m.setStyle(opcoes(estiloDoPonto(o, cores, o.numero === selecionadaAtual.current)));
    });
  }, [cores]);

  // seleção: só o anterior e o novo mudam
  const anterior = useRef<string | null>(null);
  useEffect(() => {
    const antes = anterior.current;
    selecionadaAtual.current = selecionada;
    restilizar(antes);
    restilizar(selecionada);
    marcadores.current.get(selecionada ?? "")?.m.bringToFront();
    anterior.current = selecionada;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- restilizar só lê refs
  }, [selecionada, os]);

  // foco pedido pela lista: leva o mapa até a OS
  useEffect(() => {
    if (!foco) return;
    const x = marcadores.current.get(foco.numero);
    if (!x) return;
    const ll = x.m.getLatLng();
    map.setView(ll, Math.max(map.getZoom(), 15), { animate: !reduzirMovimento() });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reage ao pedido (n), não ao objeto
  }, [foco?.n]);

  return null;
}

export function MapaRedeLeaflet({ os, selecionada, onSelecionar, foco, rotulo, altura = "max(480px, calc(100dvh - 240px))" }: MapaRedeProps) {
  const fundo = fundoAtual();
  const calmo = reduzirMovimento();
  return (
    <div role="region" aria-label={rotulo} style={{ height: altura, border: "1px solid var(--ln)" }}>
      <MapContainer
        center={BRASIL}
        zoom={4}
        preferCanvas
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom
        zoomAnimation={!calmo}
        fadeAnimation={!calmo}
        markerZoomAnimation={!calmo}
      >
        <TileLayer url={fundo.url} maxZoom={fundo.zoomMax} attribution={fundo.atribuicao} />
        <CamadaOS os={os} selecionada={selecionada} onSelecionar={onSelecionar} foco={foco} />
      </MapContainer>
    </div>
  );
}
