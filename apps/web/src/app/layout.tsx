import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { AppRouterCacheProvider } from "@mui/material-nextjs/v15-appRouter";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Farol - fila e despacho",
  description: "Priorização de ordens de serviço de manutenção da rede elétrica",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

// Aplica o tema salvo antes da primeira pintura (evita flash). Claro é o padrão; "d" = escuro.
const temaInicial = `try{if(localStorage.getItem("farol-tema")==="d")document.documentElement.dataset.t="d"}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: temaInicial }} />
      </head>
      <body>
        {/* Estilos dos ícones MUI em @layer mui: as classes BEM do projeto (fora de layer) sempre prevalecem. */}
        <AppRouterCacheProvider options={{ enableCssLayer: true }}>
          <Providers>{children}</Providers>
        </AppRouterCacheProvider>
      </body>
    </html>
  );
}
