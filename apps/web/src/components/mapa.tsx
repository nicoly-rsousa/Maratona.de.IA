"use client";

import dynamic from "next/dynamic";
import type { MapaProps } from "./mapa-leaflet";

/** Leaflet precisa de `window`: carregado só no navegador (sem SSR). */
export const Mapa = dynamic<MapaProps>(() => import("./mapa-leaflet").then((m) => m.MapaLeaflet), {
  ssr: false,
  loading: () => (
    <div role="status">
      <div className="sk" style={{ height: 200 }} />
      <p className="mu">Carregando o mapa…</p>
    </div>
  ),
});
