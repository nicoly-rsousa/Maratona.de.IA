"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import MapOutlined from "@mui/icons-material/MapOutlined";
import { consultaMapa } from "@/lib/consultas";
import { EstadoConsulta } from "@/components/estados";
import { Icone } from "@/components/icone";
import { Mapa } from "@/components/mapa";

interface Props {
  cidade: string;
  cidadeNome: string;
  ponto: { lat: number; lng: number } | null;
  onEscolher: (p: { lat: number; lng: number }) => void;
}

/** Mapa opcional para escolher o ponto da OS; só consulta a API quando aberto. Mostra as OS abertas da cidade (ajuda a ver duplicidade). */
export function SeletorPonto({ cidade, cidadeNome, ponto, onEscolher }: Props) {
  const [aberto, setAberto] = useState(false);
  const mapa = useQuery({ ...consultaMapa(cidade), enabled: cidade !== "" && aberto });

  return (
    <div className="form-grid__wide flex flex-col gap-3">
      <div className="button-group">
        <button type="button" className="button" aria-expanded={aberto} onClick={() => setAberto((v) => !v)}>
          <Icone de={MapOutlined} />{aberto ? "Ocultar o mapa" : "Escolher o ponto no mapa"}
        </button>
        <span className="button-group__note">Também dá para digitar latitude e longitude.</span>
      </div>
      {aberto && (
        <EstadoConsulta consulta={mapa} carregando="Carregando o mapa…" erro="Não foi possível carregar o mapa.">
          {(d) => (
            <>
              <p className="text-muted">
                Clique no mapa para preencher latitude e longitude. O círculo mostra o raio de {d.raioM} m da sugestão de duplicidade; os pontos coloridos são as OS abertas.
              </p>
              <Mapa
                os={d.os} equipes={[]} mostrarEquipes={false} selecionadaId={null}
                raioM={d.raioM} centro={d.centro} chave={cidade} rotulo={`Mapa para escolher o local em ${cidadeNome}`}
                altura={340} ponto={ponto} onClicar={onEscolher}
              />
            </>
          )}
        </EstadoConsulta>
      )}
    </div>
  );
}
