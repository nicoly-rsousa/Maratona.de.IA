"use client";

import { useQuery } from "@tanstack/react-query";
import { textoCondicoes, type RespostaRegras } from "@farol/shared";
import { api } from "@/lib/api";
import { dataHora } from "@/lib/format";
import { Carregando, ErroApi, Pill } from "@/components/ui";

export default function PrecedenciaPage() {
  const q = useQuery({ queryKey: ["regras"], queryFn: () => api<RespostaRegras>("/regras") });

  return (
    <>
      <h2>Regras de precedência (camada A)</h2>
      <p className="mu">
        Cada regra é um E lógico de condições e define um nível de precedência (1–10) e uma prioridade mínima. Valores demonstrativos.
        Vale para todas as cidades.
      </p>
      <div className="warn" role="note">
        <b>Somente leitura — edição em breve.</b> Alterar uma regra exigirá o perfil Administrador, justificativa e gerará nova versão.
      </div>
      {q.isPending ? (
        <Carregando texto="Carregando as regras…" />
      ) : q.isError ? (
        <ErroApi erro={q.error} titulo="Não foi possível carregar as regras de precedência." onRetry={() => q.refetch()} />
      ) : q.data.regras.length === 0 ? (
        <p className="mu">Nenhuma regra cadastrada.</p>
      ) : (
        <div className="tw">
          <table className="tabela">
            <thead>
              <tr><th>Ativa</th><th>Regra</th><th>Condição</th><th>Nível</th><th>Prioridade mínima</th><th>Versão</th></tr>
            </thead>
            <tbody>
              {q.data.regras.map((r) => (
                <tr key={r.id} className="r">
                  <td>
                    <input type="checkbox" checked={r.ativa} disabled aria-label={`${r.nome}: ${r.ativa ? "ativa" : "inativa"} (somente leitura)`} />
                  </td>
                  <td><b>{r.nome}</b> <span className="mu m">{r.id}</span></td>
                  <td className="whitespace-normal">{textoCondicoes(r.condicoes)}</td>
                  <td className="m">{r.nivel}</td>
                  <td><Pill codigo={r.prioridadeMinima} /></td>
                  <td className="m" title={`atualizada em ${dataHora(r.atualizadoEm)}`}>v{r.versao}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
