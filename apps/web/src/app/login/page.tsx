"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import LoginIcon from "@mui/icons-material/Login";
import { supabase, supabaseConfigurado } from "@/lib/supabase";
import { useAuth } from "../providers";
import { IconeFarol } from "@/components/logo";
import { Alerta } from "@/components/alerta";
import { CampoFormulario } from "@/components/campo";
import { Icone } from "@/components/icone";

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
    <main className="login">
      <div className="login__panel">
        <div className="login__brand">
          <IconeFarol tamanho={56} />
          <h1 className="login__title">Farol</h1>
          <p className="login__subtitle">Fila e despacho de ordens de serviço</p>
        </div>
        <form onSubmit={entrar} className="card login__form" aria-label="Entrar no Farol">
          {!supabaseConfigurado() && (
            <Alerta tipo="warning" role="alert" titulo="Supabase não configurado">
              Defina <code>NEXT_PUBLIC_SUPABASE_URL</code> e <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> em <code>apps/web/.env.local</code>.
            </Alerta>
          )}
          <CampoFormulario id="login-email" rotulo="E-mail" obrigatorio>
            {(a) => <input {...a} className="control" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />}
          </CampoFormulario>
          <CampoFormulario id="login-senha" rotulo="Senha" obrigatorio>
            {(a) => <input {...a} className="control" type="password" autoComplete="current-password" required value={senha} onChange={(e) => setSenha(e.target.value)} />}
          </CampoFormulario>
          {erro && <Alerta tipo="error" role="alert">{erro}</Alerta>}
          <button type="submit" className="button button--primary login__submit" disabled={enviando || !supabaseConfigurado()}>
            <Icone de={LoginIcon} />{enviando ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </div>
    </main>
  );
}
