"use client";

import { useCallback, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ESCOPO_GLOBAL, type EstadoPontuacao } from "@farol/shared";
import { api } from "@/lib/api";
import { Carregando, ErroApi } from "@/components/ui";
import { useApp } from "../app-context";
import { Painel } from "./painel";

export default function PontuacaoPage() {
  const { ator, cidades, cidade: cidadeHeader } = useApp();
  const qc = useQueryClient();

  // Escopo: "global" (só quem acessa todas as cidades) ou uma cidade. Começa pela cidade do cabeçalho.
  const opcoes = [
    ...(ator.todasCidades ? [{ id: ESCOPO_GLOBAL, nome: "Global (todas as cidades)" }] : []),
    ...cidades.map((c) => ({ id: c.id, nome: c.nome })),
  ];
  const [escolhido, setEscolhido] = useState<string | null>(null);
  const escopo = opcoes.some((o) => o.id === escolhido) ? escolhido! : (opcoes.find((o) => o.id === cidadeHeader)?.id ?? opcoes[0]?.id ?? "");
  const escopoNome = opcoes.find((o) => o.id === escopo)?.nome ?? escopo;

  // `nonce` recomeça o painel a partir do servidor (depois de uma ação ou de "Recarregar").
  const [nonce, setNonce] = useState(0);
  const [aviso, setAviso] = useState<string | null>(null);
  const sujo = useRef(false);
  const onSujo = useCallback((v: boolean) => { sujo.current = v; }, []);

  const chave = ["pontuacao", escopo];
  // Sem refetch por foco nem cache: o estado só muda quando o usuário age ou recarrega, para uma
  // atualização em segundo plano nunca apagar o que está sendo editado. Conflito = 409 ao salvar.
  const q = useQuery({
    queryKey: chave,
    queryFn: () => api<EstadoPontuacao>(`/pontuacao/versoes?escopo=${encodeURIComponent(escopo)}`),
    enabled: escopo !== "",
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
    gcTime: 0,
  });

  if (escopo === "") return <div className="warn">Seu usuário não tem cidade vinculada. Peça a um administrador para vinculá-lo a um município.</div>;

  const podeEditar = ator.permissoes.includes("pontuacao") && (escopo !== ESCOPO_GLOBAL || ator.todasCidades);
  const podeAprovar = ator.permissoes.includes("pontuacao_aprovar");

  function trocarEscopo(id: string) {
    if (sujo.current && !window.confirm("Há alterações não salvas neste rascunho. Trocar de escopo as descarta. Continuar?")) return;
    sujo.current = false;
    setAviso(null);
    setEscolhido(id);
  }

  async function recarregar() {
    await q.refetch();
    setAviso("Rascunho recarregado do servidor.");
    setNonce((n) => n + 1);
  }

  return (
    <>
      <label className="mu mb-2 flex items-center gap-1">
        Escopo
        <select value={escopo} onChange={(e) => trocarEscopo(e.target.value)} aria-label="Escopo da pontuação">
          {opcoes.map((o) => <option key={o.id} value={o.id}>{o.nome}</option>)}
        </select>
      </label>

      {q.isPending ? (
        <Carregando texto="Carregando as versões…" />
      ) : q.isError ? (
        <ErroApi erro={q.error} titulo="Não foi possível carregar as versões de pontuação." onRetry={() => q.refetch()} />
      ) : (
        <Painel
          key={`${escopo}:${nonce}`}
          estado={q.data}
          escopo={escopo}
          escopoNome={escopoNome}
          podeEditar={podeEditar}
          podeAprovar={podeAprovar}
          atorId={ator.id}
          aviso={aviso}
          onSujo={onSujo}
          onRecarregar={() => { void recarregar(); }}
          onAtualizado={(e, msg) => {
            qc.setQueryData(chave, e);
            sujo.current = false;
            setAviso(msg);
            setNonce((n) => n + 1);
          }}
        />
      )}
    </>
  );
}
