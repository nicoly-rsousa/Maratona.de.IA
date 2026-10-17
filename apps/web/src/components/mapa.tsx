"use client";

import dynamic from "next/dynamic";
import { Carregando } from "./estados";
import type { MapaProps } from "./mapa-leaflet";

/** Leaflet precisa de `window`: carregado só no navegador (sem SSR). */
export const Mapa = dynamic<MapaProps>(() => import("./mapa-leaflet").then((m) => m.MapaLeaflet), {
  ssr: false,
  loading: () => <Carregando texto="Carregando o mapa…" bloco />,
});
