import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Farol - fila e despacho",
  description: "Priorização de ordens de serviço de manutenção da rede elétrica",
};

// Aplica o tema salvo antes da primeira pintura (evita flash).
const temaInicial = `try{if(localStorage.getItem("farol-tema")==="l")document.documentElement.dataset.t="l"}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="pt-BR" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: temaInicial }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
