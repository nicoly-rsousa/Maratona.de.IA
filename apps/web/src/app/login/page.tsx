"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase, supabaseConfigurado } from "@/lib/supabase";
import { useAuth } from "../providers";
import { IconeFarol } from "@/components/logo";

export default function LoginPage() {
  const router = useRouter();
  const { session, carregando } = useAuth();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (!carregando && session) router.replace("/fila");
  }, [carregando, session, router]);

  async function entrar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setEnviando(true);
    const { error } = await supabase().auth.signInWithPassword({ email: email.trim(), password: senha });
    setEnviando(false);
    if (error) {
      setErro(error.status === 400 ? "E-mail ou senha incorretos." : "Não foi possível entrar agora. Tente de novo.");
      return;
    }
    router.replace("/fila");
  }

  return (
    <main className="mx-auto mt-16 w-[92%] max-w-sm">
      <h1 className="mb-1 flex items-center gap-1.5 text-[15px] font-bold"><IconeFarol tamanho={20} />Farol</h1>
      <p className="mu mb-3">Fila e despacho de ordens de serviço</p>
      <form onSubmit={entrar} className="box flex flex-col gap-3">
        {!supabaseConfigurado() && (
          <div className="warn" role="alert">
            Supabase não configurado. Defina <span className="m">NEXT_PUBLIC_SUPABASE_URL</span> e{" "}
            <span className="m">NEXT_PUBLIC_SUPABASE_ANON_KEY</span> em <span className="m">apps/web/.env.local</span>.
          </div>
        )}
        <label className="mu flex flex-col gap-0.5">
          E-mail
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="mu flex flex-col gap-0.5">
          Senha
          <input type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} />
        </label>
        {erro && <div className="err" role="alert">{erro}</div>}
        <button type="submit" className="btn-pr" disabled={enviando || !supabaseConfigurado()}>
          {enviando ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </main>
  );
}
