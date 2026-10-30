"use client";

import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef, useState } from "react";
import { MapContainer, TileLayer, useMap } from "react-leaflet";
import { fundoAtual } from "@/lib/fundos-mapa";
import type { OSRedeLeve } from "@/lib/rede-api";
import { raioDoCirculoTransformador, temPosicao } from "@/lib/rede";
import {
  ROTULO_CONTORNO_APROXIMADO, estiloDoSegmento, modoDoPonto, nomeDoTipoDaChave, rotuloCompacto, textoDaChave, textoDoSegmento, textoDoTransformador,
  type CircuitoNoMapa,
} from "@/lib/rede-circuito";
import {
  CORES_DO_TEMA, CORES_RESERVA, estiloDoPonto, limitesDasOS, temCoordenada, textoDoPonto, type CoresTema, type EstiloPonto,
} from "@/lib/rede-mapa";

export interface MapaRedeProps {
  os: OSRedeLeve[];
  selecionada: string | null;
  onSelecionar: (numero: string) => void;
  /** pedido de foco vindo da lista: `n` muda a cada pedido, para repetir o mesmo número */
  foco: { numero: string; n: number } | null;
  rotulo: string;
  /** px ou medida CSS */
  altura?: number | string;
  /** circuito selecionado: SÓ os dados dele são desenhados (traçado, chaves, transformadores, contorno aproximado) */
  circuito?: CircuitoNoMapa | null;
  /** código do circuito selecionado: suas OS ganham destaque e as demais ficam esmaecidas */
  circuitoDestaque?: string | null;
  /** Raio em metros desenhado ao redor da OS selecionada. */
  raioM?: number;
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

/** Tooltip compartilhado de uma camada. O texto vai SEMPRE por textContent: nada vindo de planilha/base é interpretado como HTML. */
function useTooltip(map: L.Map) {
  const ref = useRef<L.Tooltip | null>(null);
  const mostrar = (latlng: L.LatLng, texto: string, offset: [number, number] = [0, -6]) => {
    ref.current ??= L.tooltip({ direction: "top", offset });
    const el = document.createElement("div");
    el.textContent = texto;
    ref.current.setContent(el).setLatLng(latlng);
    if (!map.hasLayer(ref.current)) ref.current.addTo(map);
  };
  const esconder = () => { ref.current?.remove(); };
  return { mostrar, esconder };
}

/**
 * UMA camada imperativa para as OS (não um componente React por ponto): os marcadores são criados uma vez por conjunto de dados,
 * desenhados no canvas do mapa, com um único tooltip compartilhado. Seleção, destaque de circuito e tema só restilizam o necessário.
 */
function CamadaOS({ os, selecionada, onSelecionar, foco, circuitoDestaque }: Pick<MapaRedeProps, "os" | "selecionada" | "onSelecionar" | "foco"> & { circuitoDestaque: string | null }) {
  const map = useMap();
  const cores = useCoresTema();
  const tip = useTooltip(map);
  const marcadores = useRef(new Map<string, { m: L.CircleMarker; o: OSRedeLeve }>());
  const jaEnquadrou = useRef(false);
  const aoSelecionar = useRef(onSelecionar);
  const coresAtuais = useRef(cores);
  const selecionadaAtual = useRef<string | null>(selecionada);
  const destaqueAtual = useRef<string | null>(circuitoDestaque);
  const tipAtual = useRef(tip);
  aoSelecionar.current = onSelecionar;
  coresAtuais.current = cores;
  tipAtual.current = tip;

  const estilo = (o: OSRedeLeve, c: CoresTema = coresAtuais.current) =>
    opcoes(estiloDoPonto(o, c, o.numero === selecionadaAtual.current, modoDoPonto(o, destaqueAtual.current)));

  // (re)cria a camada quando o conjunto de dados muda
  useEffect(() => {
    const grupo = L.featureGroup();
    const novos = new Map<string, { m: L.CircleMarker; o: OSRedeLeve }>();
    for (const o of os) {
      if (!temCoordenada(o)) continue;
      const m = L.circleMarker([o.lat, o.lng], estilo(o));
      m.on("click", () => aoSelecionar.current(o.numero));
      m.on("mouseover", (e: L.LeafletMouseEvent) => tipAtual.current.mostrar(e.latlng, textoDoPonto(o)));
      m.on("mouseout", () => tipAtual.current.esconder());
      grupo.addLayer(m);
      novos.set(o.numero, { m, o });
    }
    grupo.addTo(map);
    marcadores.current = novos;
    if (!jaEnquadrou.current) {
      const lim = limitesDasOS(os);
      if (lim) { map.fitBounds(lim, { padding: [30, 30], maxZoom: 16 }); jaEnquadrou.current = true; }
    }
    return () => { tipAtual.current.esconder(); grupo.remove(); marcadores.current = new Map(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `estilo` só lê refs
  }, [map, os]);

  // troca de tema ou de circuito em destaque: restiliza todos (o desenho em canvas é agrupado pelo Leaflet)
  useEffect(() => {
    destaqueAtual.current = circuitoDestaque;
    marcadores.current.forEach(({ m, o }) => m.setStyle(estilo(o, cores)));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `estilo` só lê refs
  }, [cores, circuitoDestaque]);

  // seleção: só o anterior e o novo mudam
  const anterior = useRef<string | null>(null);
  useEffect(() => {
    const antes = anterior.current;
    selecionadaAtual.current = selecionada;
    for (const n of [antes, selecionada]) {
      const x = n ? marcadores.current.get(n) : undefined;
      if (x) x.m.setStyle(estilo(x.o));
    }
    marcadores.current.get(selecionada ?? "")?.m.bringToFront();
    anterior.current = selecionada;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `estilo` só lê refs
  }, [selecionada, os]);

  // foco pedido pela lista: leva o mapa até a OS
  useEffect(() => {
    if (!foco) return;
    const x = marcadores.current.get(foco.numero);
    if (!x) return;
    map.setView(x.m.getLatLng(), Math.max(map.getZoom(), 15), { animate: !reduzirMovimento() });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reage ao pedido (n), não ao objeto
  }, [foco?.n]);

  return null;
}

/**
 * Camada do circuito SELECIONADO (nada de outros circuitos): contorno aproximado (se houver), traçado por trecho,
 * chaves por tipo e transformadores como círculo com a contagem de clientes identificados. Recriada só quando o circuito muda.
 */
/** Círculo de proximidade da OS selecionada; não intercepta cliques dos pontos nem da rede. */
function CamadaRaio({ os, selecionada, raioM = 1_000 }: Pick<MapaRedeProps, "os" | "selecionada" | "raioM">) {
  const map = useMap();
  const cores = useCoresTema();
  useEffect(() => {
    const osSelecionada = selecionada ? os.find((o) => o.numero === selecionada) : undefined;
    if (!osSelecionada || !temCoordenada(osSelecionada)) return;
    const circulo = L.circle([osSelecionada.lat, osSelecionada.lng], {
      radius: raioM,
      color: cores["--ac"] || "#5cc8d6",
      weight: 2,
      opacity: 0.9,
      dashArray: "7 5",
      fillColor: cores["--ac"] || "#5cc8d6",
      fillOpacity: 0.08,
      interactive: false,
    });
    circulo.addTo(map);
    return () => { circulo.remove(); };
  }, [map, os, selecionada, raioM, cores]);
  return null;
}

function CamadaCircuito({ circuito }: { circuito: CircuitoNoMapa | null | undefined }) {
  const map = useMap();
  const cores = useCoresTema();
  const tip = useTooltip(map);
  const tipAtual = useRef(tip);
  tipAtual.current = tip;
  const fitFeito = useRef<string | null>(null);

  useEffect(() => {
    if (!circuito) return;
    const grupo = L.featureGroup();
    const dica = (l: L.Layer, texto: string) => {
      l.on("mouseover", (e) => tipAtual.current.mostrar((e as L.LeafletMouseEvent).latlng, texto));
      l.on("mouseout", () => tipAtual.current.esconder());
    };

    // 1) contorno aproximado, por baixo de tudo; só polígono (com menos de 3 chaves distintas ou alinhadas, só os pontos)
    if (circuito.contorno?.tipo === "poligono") {
      const poli = L.polygon(circuito.contorno.vertices.map((v) => [v.lat, v.lng] as [number, number]), {
        color: cores["--ac"] || "#5cc8d6", weight: 2, dashArray: "8 6", fillOpacity: 0.06,
      });
      dica(poli, ROTULO_CONTORNO_APROXIMADO);
      grupo.addLayer(poli);
    }
    // 2) traçado: cor pelo campo `trecho`
    for (const f of circuito.tracado) {
      const linha = L.polyline(f.geometry.coordinates.map(([lng, lat]) => [lat, lng] as [number, number]), { ...estiloDoSegmento(f), lineCap: "round" });
      dica(linha, textoDoSegmento(f));
      grupo.addLayer(linha);
    }
    // 3) chaves: cor pelo NOME do tipo (a legenda usa as mesmas cores)
    for (const c of circuito.chaves) {
      const [lng, lat] = c.geometry.coordinates;
      const m = L.circleMarker([lat, lng], {
        radius: 4, color: "#ffffff", weight: 1.2, fillColor: circuito.coresChaves[nomeDoTipoDaChave(c)] ?? "#111111", fillOpacity: 1,
      });
      dica(m, textoDaChave(c));
      grupo.addLayer(m);
    }
    // 4) transformadores: só os COM posição; círculo com a contagem de clientes identificados (sem posição = não desenha, nunca inventa)
    for (const t of circuito.transformadores) {
      if (!temPosicao(t)) continue;
      const d = raioDoCirculoTransformador(t.clientes) * 2;
      const el = document.createElement("div");
      el.className = "farol-trafo";
      el.style.width = `${d}px`;
      el.style.height = `${d}px`;
      el.textContent = rotuloCompacto(t.clientes);
      const m = L.marker([t.lat, t.lng], {
        icon: L.divIcon({ html: el, className: "farol-trafo-icone", iconSize: [d, d] }),
        keyboard: false, // centenas de marcadores não entram na ordem de Tab; o painel traz o resumo em texto
      });
      dica(m, textoDoTransformador(t));
      grupo.addLayer(m);
    }
    grupo.addTo(map);
    return () => { tipAtual.current.esconder(); grupo.remove(); };
  }, [map, circuito, cores]);

  // enquadra UMA vez por circuito, assim que existirem limites (o bbox vem da lista; senão das OS/chaves/transformadores carregados)
  useEffect(() => {
    if (!circuito) { fitFeito.current = null; return; }
    if (fitFeito.current === circuito.codigo || !circuito.limites) return;
    map.fitBounds(circuito.limites, { padding: [40, 40], maxZoom: 17, animate: !reduzirMovimento() });
    fitFeito.current = circuito.codigo;
  }, [map, circuito]);

  return null;
}

export function MapaRedeLeaflet({
  os, selecionada, onSelecionar, foco, rotulo, circuito = null, circuitoDestaque = null, raioM = 1_000, altura = "max(480px, calc(100dvh - 240px))",
}: MapaRedeProps) {
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
        <CamadaOS os={os} selecionada={selecionada} onSelecionar={onSelecionar} foco={foco} circuitoDestaque={circuitoDestaque} />
        <CamadaRaio os={os} selecionada={selecionada} raioM={raioM} />
        <CamadaCircuito circuito={circuito} />
      </MapContainer>
    </div>
  );
}
