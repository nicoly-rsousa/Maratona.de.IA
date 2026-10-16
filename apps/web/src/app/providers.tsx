"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Session } from "@supabase/supabase-js";
import { ApiError } from "@/lib/api";
import { supabase, supabaseConfigurado } from "@/lib/supabase";

interface AuthState {
  session: Session | null;
  carregando: boolean;
}
const AuthCtx = createContext<AuthState>({ session: null, carregando: true });
export const useAuth = () => useContext(AuthCtx);

function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>({ session: null, carregando: true });

  useEffect(() => {
    if (!supabaseConfigurado()) {
      setState({ session: null, carregando: false });
      return;
    }
    const sb = supabase();
    sb.auth.getSession().then(({ data }) => setState({ session: data.session, carregando: false }));
    const { data } = sb.auth.onAuthStateChange((_ev, session) => setState({ session, carregando: false }));
    return () => data.subscription.unsubscribe();
  }, []);

  return <AuthCtx.Provider value={state}>{children}</AuthCtx.Provider>;
}

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // 401/403/404 são respostas definitivas; não adianta repetir.
            retry: (n, err) => !(err instanceof ApiError && [401, 403, 404].includes(err.status)) && n < 2,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>{children}</AuthProvider>
    </QueryClientProvider>
  );
}
