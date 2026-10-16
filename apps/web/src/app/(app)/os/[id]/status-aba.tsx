"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { exigeMotivo, permissaoDaTransicao, transicoesManuais, type DetalheOS, type StatusOS } from "@farol/shared";
import { apiPost } from "@/lib/api";
import type { Ator } from "@/lib/types";
import { ErroAcao } from "@/components/ui";
import { JustificativaDialog } from "@/components/justificativa-dialog";

function tituloDoDialogo(de: string, para: StatusOS) {
  if (para === "Cancelada") return "Motivo do cancelamento";
  if (para === "Suspensa") return "Motivo da suspensão";
  if (de === "Concluída") return "Justificativa da reabertura";
  return "Justificativa";
}

export function StatusAba({ d, ator }: { d: DetalheOS; ator: Ator }) {
  const qc = useQueryClient();
  const [pendente, setPendente] = useState<StatusOS | null>(null);
  const de = d.os.status;

  const todas = transicoesManuais(de);
  // Só as transições que o perfil pode fazer; a API confere de novo (403) e o banco valida o fluxo (409).
  const permitidas = todas.filter((p) => ator.permissoes.includes(permissaoDaTransicao(de, p)));

  const mudar = useMutation({
    mutationFn: (v: { para: StatusOS; motivo?: string }) => apiPost(`/os/${d.os.id}/status`, v),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["os", d.os.id] });
      qc.invalidateQueries({ queryKey: ["fila"] });
    },
  });

  function clicar(para: StatusOS) {
    mudar.reset();
    if (exigeMotivo(de, para)) setPendente(para);
    else mudar.mutate({ para });
  }

  return (
    <>
      <p>Status atual: <b>{de}</b></p>
      {todas.length === 0 ? (
        <p className="mu">Sem transições manuais a partir deste status (o ciclo do despacho conduz as demais).</p>
      ) : permitidas.length === 0 ? (
        <p className="mu">Seu perfil não tem permissão para alterar este status.</p>
      ) : (
        <p>
          {permitidas.map((p) => (
            <button key={p} disabled={mudar.isPending} onClick={() => clicar(p)} className="mr-1">
              {de === "Concluída" ? "Reabrir" : `→ ${p}`}
            </button>
          ))}
        </p>
      )}
      {mudar.isError && <ErroAcao erro={mudar.error} />}
      <p className="mu">Qualquer outra transição é recusada com 409.</p>

      <JustificativaDialog
        aberto={pendente !== null}
        titulo={pendente ? tituloDoDialogo(de, pendente) : ""}
        onConfirmar={(motivo) => {
          if (pendente) mudar.mutate({ para: pendente, motivo });
          setPendente(null);
        }}
        onCancelar={() => setPendente(null)}
      />
    </>
  );
}
