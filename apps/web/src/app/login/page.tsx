"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { supabase, supabaseConfigurado } from "@/lib/supabase";
import { useAuth } from "../providers";
import { IconeFarol } from "@/components/logo";
import styles from "./login.module.css";

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
    <main className={styles.page}>
      <section className={styles.visual} aria-label="Farol — gestão da manutenção de redes elétricas">
        <div className={styles.brand}><IconeFarol tamanho={38} /><span>Farol<span className={styles.brandDot}>.</span></span></div>
        <div className={styles.visualCopy}>
          <span className={styles.eyebrow}><span /> CONECTANDO DECISÕES E OPERAÇÕES</span>
          <h2>Clareza para decidir.<br />Energia para agir.</h2>
          <p>Uma visão integrada para priorizar, acompanhar e transformar a manutenção da rede elétrica.</p>
        </div>
        <div className={styles.visualFooter}><span>Inteligência em cada prioridade.</span><span>FAROL / OPERAÇÕES</span></div>
      </section>
      <section className={styles.formPanel} aria-labelledby="login-title">
        <div className={styles.mobileBrand}><IconeFarol tamanho={32} />Farol.</div>
        <div className={styles.formContent}>
          <span className={styles.formEyebrow}>SEU CENTRO DE OPERAÇÕES</span>
          <h1 id="login-title">Boas-vindas de volta.</h1>
          <p className={styles.description}>Entre na sua conta para acompanhar as ordens de serviço e manter tudo em movimento.</p>
      <form onSubmit={entrar} className={styles.form}>
        {!supabaseConfigurado() && (
          <div className="warn" role="alert">
            Supabase não configurado. Defina <span className="m">NEXT_PUBLIC_SUPABASE_URL</span> e{" "}
            <span className="m">NEXT_PUBLIC_SUPABASE_ANON_KEY</span> em <span className="m">apps/web/.env.local</span>.
          </div>
        )}
        <label className={styles.label}>
          E-mail
          <input type="email" autoComplete="username" placeholder="seu.email@empresa.com.br" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className={styles.label}>
          Senha
          <input type="password" autoComplete="current-password" placeholder="Digite sua senha" required value={senha} onChange={(e) => setSenha(e.target.value)} />
        </label>
        {erro && <div className="err" role="alert">{erro}</div>}
        <button type="submit" className={styles.submit} disabled={enviando || !supabaseConfigurado()}>
          {enviando ? "Entrando…" : "Entrar na plataforma"}
          <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
        </button>
      </form>
          <p className={styles.help}>Precisa de acesso? Fale com o administrador da sua equipe.</p>
        </div>
        <footer className={styles.formFooter}><span>Farol © {new Date().getFullYear()}</span><span>Gestão que ilumina decisões.</span></footer>
      </section>
    </main>
  );
}
