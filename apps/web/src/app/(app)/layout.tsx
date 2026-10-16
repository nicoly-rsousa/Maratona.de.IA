"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { Ator, Cidade } from "@/lib/types";
import { Carregando, ErroApi } from "@/components/ui";
import { useAuth } from "../providers";
import { AppProvider } from "./app-context";

function alternarTema() {
  const r = document.documentElement;
  const claro = r.dataset.t !== "l";
  if (claro) r.dataset.t = "l";
  else delete r.dataset.t;
  try { localStorage.setItem("farol-tema", claro ? "l" : "d"); } catch { /* storage indisponível */ }
}

export default function AppLayout({ children }: { children: ReactNode }) {
  const { session, carregando } = useAuth();
  const router = useRouter();
  const path = usePathname();
  const qc = useQueryClient();
  const [escolhida, setEscolhida] = useState<string | null>(null);

  useEffect(() => {
    if (!carregando && !session) router.replace("/login");
  }, [carregando, session, router]);

  const me = useQuery({ queryKey: ["me", session?.user.id], queryFn: () => api<Ator>("/me"), enabled: !!session });
  const cids = useQuery({ queryKey: ["cidades", session?.user.id], queryFn: () => api<Cidade[]>("/cidades"), enabled: !!me.data });

  async function sair() {
    await supabase().auth.signOut();
    qc.clear();
    router.replace("/login");
  }

  if (carregando || !session) return <main className="p-3"><Carregando texto="Carregando…" /></main>;

  const ator = me.data;
  const cidades = cids.data;
  const valida = (id: string | null) => id != null && ((id === "*" && !!ator?.todasCidades) || !!cidades?.some((c) => c.id === id));
  const cidade = valida(escolhida) ? escolhida! : (cidades?.[0]?.id ?? (ator?.todasCidades ? "*" : ""));

  const ready = ator && cidades;

  return (
    <>
      <header className="flex flex-wrap items-center gap-2 border-b border-ln bg-p1 px-3 py-2">
        <b className="mr-2 text-[15px]">Farol</b>
        {ator && <span className="mu">{ator.nome} · {ator.perfil}</span>}
        {ready && (
          <label className="mu flex items-center gap-1">
            Cidade
            <select value={cidade} onChange={(e) => { setEscolhida(e.target.value); if (path !== "/fila") router.push("/fila"); }}>
              {cidades.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              {ator.todasCidades && <option value="*">Todas as cidades</option>}
            </select>
          </label>
        )}
        <button onClick={alternarTema} aria-label="Alternar tema claro e escuro">Tema</button>
        <button onClick={sair}>Sair</button>
        <span className="mu">Pontos, faixas e prazos demonstrativos</span>
      </header>

      <div className="flex min-h-[calc(100vh-46px)] max-[700px]:flex-col">
        <nav aria-label="Telas" className="flex w-[150px] flex-col gap-1 border-r border-ln p-2 max-[700px]:w-auto max-[700px]:flex-row max-[700px]:flex-wrap max-[700px]:border-b max-[700px]:border-r-0">
          <Link
            href="/fila"
            className="btn-nav block rounded-[3px] border px-[7px] py-1"
            aria-current={path === "/fila" || path.startsWith("/os/")}
          >
            Fila
          </Link>
        </nav>
        <main className="min-w-0 flex-1 p-3" aria-live="polite">
          {me.isError ? (
            <ErroApi erro={me.error} titulo="Não foi possível identificar seu usuário." onRetry={() => me.refetch()} />
          ) : cids.isError ? (
            <ErroApi erro={cids.error} titulo="Não foi possível carregar as cidades." onRetry={() => cids.refetch()} />
          ) : !ready ? (
            <Carregando texto="Carregando…" />
          ) : (
            <AppProvider value={{ ator, cidades, cidade, setCidade: setEscolhida }}>{children}</AppProvider>
          )}
        </main>
      </div>
    </>
  );
}
