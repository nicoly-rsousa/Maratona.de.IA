"use client";

import dynamic from "next/dynamic";
import type { MapaRedeProps } from "./mapa-rede-leaflet";

/** Leaflet precisa de `window`: carregado só no navegador (sem SSR), como o mapa já existente. */
export const MapaRede = dynamic<MapaRedeProps>(() => import("./mapa-rede-leaflet").then((m) => m.MapaRedeLeaflet), {
  ssr: false,
  loading: () => (
    <div role="status">
      <div className="sk" style={{ height: 200 }} />
      <p className="mu">Carregando o mapa…</p>
    </div>
  ),
});
