"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { Ator, Cidade } from "@/lib/types";
import { Carregando, ErroApi } from "@/components/ui";
import { IconeFarol } from "@/components/logo";
import { useAuth } from "../providers";
import { AppProvider, SEM_ALIMENTADOR } from "./app-context";

function alternarTema() {
  const r = document.documentElement;
  const claro = r.dataset.t !== "l";
  if (claro) r.dataset.t = "l";
  else delete r.dataset.t;
  try { localStorage.setItem("farol-tema", claro ? "l" : "d"); } catch { /* storage indisponível */ }
}

interface RespostaAlimentadores {
  circuitos: string[];
  sem_alimentador: boolean;
}

/** Telas do protótipo. `perm` = qualquer permissão do /me que libera o item; sem `href` = ainda não implementada. */
const ITENS: { rotulo: string; href?: string; perm?: string[]; semPerfis?: string[] }[] = [
  { rotulo: "Fila", href: "/fila" },
  { rotulo: "Nova solicitação", href: "/nova", perm: ["nova"] },
  { rotulo: "Pontuação", href: "/pontuacao", perm: ["pontuacao", "pontuacao_aprovar"] },
  { rotulo: "Precedência", href: "/precedencia", perm: ["regras", "consultar"], semPerfis: ["Usuário Chave", "Equipe de campo"] },
  { rotulo: "Mapa", href: "/mapa", perm: ["consultar"] },
  // Aparece para todos com `consultar`; quem pode usar a rede é decidido pelo servidor (/rede/config → 403 vira mensagem na própria tela).
  { rotulo: "Mapa da rede", href: "/rede", perm: ["consultar"] },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const { session, carregando } = useAuth();
  const router = useRouter();
  const path = usePathname();
  const qc = useQueryClient();
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const [alimentadorEscolhido, setAlimentadorEscolhido] = useState("");

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
  const alimentadores = useQuery({
    queryKey: ["alimentadores", session?.user.id, cidade],
    queryFn: () => api<RespostaAlimentadores>(`/os/alimentadores?cidade=${encodeURIComponent(cidade)}`),
    enabled: !!ready && cidade !== "",
  });

  return (
    <>
      <header className="app-header">
        <b className="app-brand"><IconeFarol />Farol</b>
        {ator && <span className="mu">Usuário: <b className="font-semibold text-tx">{ator.nome}</b> · {ator.perfil}</span>}
        {ready && (
          <label className="mu flex items-center gap-1">
            Cidade
            <select value={cidade} onChange={(e) => { setEscolhida(e.target.value); setAlimentadorEscolhido(""); if (path !== "/fila" && path !== "/mapa" && path !== "/rede") router.push("/fila"); }}>
              {cidades.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              {ator.todasCidades && <option value="*">Todas as cidades</option>}
            </select>
          </label>
        )}
        {ready && cidade !== "" && (
          <label className="mu flex items-center gap-1">
            Alimentador
            <select
              value={alimentadorEscolhido}
              disabled={alimentadores.isPending || alimentadores.isError}
              onChange={(e) => {
                setAlimentadorEscolhido(e.target.value);
                if (path !== "/fila" && path !== "/mapa") router.push("/fila");
              }}
            >
              <option value="">{alimentadores.isPending ? "Carregando…" : "Todos os alimentadores"}</option>
              {(alimentadores.data?.circuitos ?? []).map((codigo) => <option key={codigo} value={codigo}>{codigo}</option>)}
              {alimentadores.data?.sem_alimentador && <option value={SEM_ALIMENTADOR}>Sem alimentador identificado</option>}
            </select>
          </label>
        )}
        {alimentadores.isError && (
          <span role="alert" className="mu">
            Não foi possível carregar os alimentadores.{" "}
            <button type="button" onClick={() => alimentadores.refetch()}>Tentar novamente</button>
          </span>
        )}
        <button onClick={alternarTema} aria-label="Alternar tema claro e escuro">Tema</button>
        <button onClick={sair}>Sair</button>
        <span className="mu">Pontos, faixas e prazos demonstrativos</span>
      </header>

      <div className="app-shell">
        <nav aria-label="Telas" className="app-nav">
          {ITENS.filter((i) => !i.semPerfis?.includes(ator?.perfil ?? "") && (!i.perm || i.perm.some((p) => ator?.permissoes.includes(p)))).map((i) =>
            i.href ? (
              <Link
                key={i.rotulo}
                href={i.href}
                className="btn-nav block rounded-[3px] border px-[7px] py-1"
                aria-current={i.href === "/fila" ? path === "/fila" || path.startsWith("/os/") : path === i.href}
              >
                {i.rotulo}
              </Link>
            ) : (
              <button key={i.rotulo} type="button" disabled className="btn-nav w-full" title="Em breve">
                {i.rotulo} <span className="mu text-[11px]">em breve</span>
              </button>
            ),
          )}
        </nav>
        <main className="app-main" aria-live="polite">
          {me.isError ? (
            <ErroApi erro={me.error} titulo="Não foi possível identificar seu usuário." onRetry={() => me.refetch()} />
          ) : cids.isError ? (
            <ErroApi erro={cids.error} titulo="Não foi possível carregar as cidades." onRetry={() => cids.refetch()} />
          ) : !ready ? (
            <Carregando texto="Carregando…" />
          ) : (
            <AppProvider value={{ ator, cidades, cidade, setCidade: setEscolhida, alimentador: alimentadorEscolhido, setAlimentador: setAlimentadorEscolhido }}>{children}</AppProvider>
          )}
        </main>
      </div>
    </>
  );
}
