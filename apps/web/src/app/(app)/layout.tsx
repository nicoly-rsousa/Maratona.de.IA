"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link, { useLinkStatus } from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { SvgIconComponent } from "@mui/icons-material";
import AddCircleOutline from "@mui/icons-material/AddCircleOutlineOutlined";
import DarkModeOutlined from "@mui/icons-material/DarkModeOutlined";
import FormatListNumbered from "@mui/icons-material/FormatListNumbered";
import LightModeOutlined from "@mui/icons-material/LightModeOutlined";
import LocationCityOutlined from "@mui/icons-material/LocationCityOutlined";
import Logout from "@mui/icons-material/Logout";
import MapOutlined from "@mui/icons-material/MapOutlined";
import PersonOutline from "@mui/icons-material/PersonOutlineOutlined";
import Rule from "@mui/icons-material/Rule";
import Tune from "@mui/icons-material/Tune";
import { api } from "@/lib/api";
import { supabase } from "@/lib/supabase";
import type { Ator, Cidade } from "@/lib/types";
import { ErroApi } from "@/components/alerta";
import { Carregando } from "@/components/estados";
import { Icone } from "@/components/icone";
import { IconeFarol } from "@/components/logo";
import { useAuth } from "../providers";
import { AppProvider } from "./app-context";

/** Tema: claro é o padrão; `data-t="d"` liga o escuro. A escolha fica em localStorage ("farol-tema"). */
function useTemaEscuro(): [boolean, () => void] {
  const [escuro, setEscuro] = useState(false);
  useEffect(() => { setEscuro(document.documentElement.dataset.t === "d"); }, []);
  function alternar() {
    const r = document.documentElement;
    const novo = r.dataset.t !== "d";
    if (novo) r.dataset.t = "d";
    else delete r.dataset.t;
    try { localStorage.setItem("farol-tema", novo ? "d" : "l"); } catch { /* storage indisponível */ }
    setEscuro(novo);
  }
  return [escuro, alternar];
}

/**
 * Feedback imediato no item clicado enquanto a tela carrega (no `next dev`, a 1ª visita a uma rota a compila e pode
 * levar segundos). Precisa ficar dentro do <Link>: useLinkStatus lê o estado do link ancestral.
 */
function IndicadorNavegacao() {
  const { pending } = useLinkStatus();
  return pending ? <span className="app-nav__pending" role="status" aria-label="Carregando a tela" /> : null;
}

/** Telas do protótipo. `perm` = qualquer permissão do /me que libera o item; `semPerfis` = perfis que não veem o item. */
const ITENS: { rotulo: string; href: string; icone: SvgIconComponent; perm?: string[]; semPerfis?: string[] }[] = [
  { rotulo: "Fila", href: "/fila", icone: FormatListNumbered },
  { rotulo: "Nova solicitação", href: "/nova", icone: AddCircleOutline, perm: ["nova"] },
  { rotulo: "Pontuação", href: "/pontuacao", icone: Tune, perm: ["pontuacao", "pontuacao_aprovar"] },
  { rotulo: "Precedência", href: "/precedencia", icone: Rule, perm: ["regras", "consultar"], semPerfis: ["Usuário Chave", "Equipe de campo"] },
  { rotulo: "Mapa", href: "/mapa", icone: MapOutlined, perm: ["consultar"] },
];

export default function AppLayout({ children }: { children: ReactNode }) {
  const { session, carregando } = useAuth();
  const router = useRouter();
  const path = usePathname();
  const qc = useQueryClient();
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const [escuro, alternarTema] = useTemaEscuro();

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

  if (carregando || !session) return <main className="app-layout__main"><Carregando texto="Carregando…" /></main>;

  const ator = me.data;
  const cidades = cids.data;
  const valida = (id: string | null) => id != null && ((id === "*" && !!ator?.todasCidades) || !!cidades?.some((c) => c.id === id));
  const cidade = valida(escolhida) ? escolhida! : (cidades?.[0]?.id ?? (ator?.todasCidades ? "*" : ""));

  const ready = ator && cidades;
  const ativo = (href: string) => (href === "/fila" ? path === "/fila" || path.startsWith("/os/") : path === href);
  const itens = ITENS.filter((i) => !i.semPerfis?.includes(ator?.perfil ?? "") && (!i.perm || i.perm.some((p) => ator?.permissoes.includes(p))));

  return (
    <>
      <a href="#conteudo" className="skip-link">Pular para o conteúdo</a>
      <header className="app-header">
        <Link href="/fila" className="app-header__brand">
          <IconeFarol />
          <span>
            <span className="app-header__brand-name">Farol</span>
            <span className="app-header__tagline block">Pontos, faixas e prazos demonstrativos</span>
          </span>
        </Link>
        <div className="app-header__context">
          {ator && (
            <span className="app-header__user">
              <Icone de={PersonOutline} />
              <span className="app-header__user-name">{ator.nome}</span>
              <span>· {ator.perfil}</span>
            </span>
          )}
          {ready && (
            <label className="app-header__city">
              <Icone de={LocationCityOutlined} />
              <span>Cidade</span>
              <select
                className="control control--sm control--auto"
                value={cidade}
                onChange={(e) => { setEscolhida(e.target.value); if (path !== "/fila" && path !== "/mapa") router.push("/fila"); }}
              >
                {cidades.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                {ator.todasCidades && <option value="*">Todas as cidades</option>}
              </select>
            </label>
          )}
          <div className="app-header__actions">
            <button type="button" className="button button--ghost button--sm" aria-pressed={escuro} onClick={alternarTema}>
              <Icone de={escuro ? LightModeOutlined : DarkModeOutlined} />Tema escuro
            </button>
            <button type="button" className="button button--sm" onClick={sair}>
              <Icone de={Logout} />Sair
            </button>
          </div>
        </div>
      </header>

      <div className="app-layout">
        <nav aria-label="Telas" className="app-nav">
          <ul className="app-nav__list">
            {itens.map((i) => (
              <li key={i.href}>
                <Link
                  href={i.href}
                  className={ativo(i.href) ? "app-nav__link app-nav__link--active" : "app-nav__link"}
                  aria-current={ativo(i.href) ? "page" : undefined}
                >
                  <Icone de={i.icone} />
                  {i.rotulo}
                  <IndicadorNavegacao />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <main id="conteudo" tabIndex={-1} className="app-layout__main">
          {me.isError ? (
            <ErroApi erro={me.error} titulo="Não foi possível identificar seu usuário." onRetry={() => me.refetch()} />
          ) : cids.isError ? (
            <ErroApi erro={cids.error} titulo="Não foi possível carregar as cidades." onRetry={() => cids.refetch()} />
          ) : !ready ? (
            <Carregando texto="Carregando…" />
          ) : (
            <AppProvider value={{ ator, cidades, cidade, setCidade: setEscolhida }}>
              <div className="page">{children}</div>
            </AppProvider>
          )}
        </main>
      </div>
    </>
  );
}
