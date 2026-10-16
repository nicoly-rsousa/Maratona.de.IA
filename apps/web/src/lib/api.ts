import { supabase } from "./supabase";

/** Campos extras do corpo de erro da API: `regra` (qual regra do banco falhou) e, na pontuação, `erros`/`alertas`. */
export interface DetalheErro {
  regra?: string;
  erros?: string[];
  alertas?: string[];
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public detalhe: DetalheErro = {}) {
    super(message);
  }
}

const lista = (v: unknown) => (Array.isArray(v) && v.every((x) => typeof x === "string") ? (v as string[]) : undefined);

/** Requisição autenticada na API (Bearer = token do Supabase Auth). Filtros de cidade/perfil são do servidor. */
async function chamar<T>(path: string, init: RequestInit = {}): Promise<T> {
  const base = process.env.NEXT_PUBLIC_API_URL;
  if (!base) throw new ApiError(0, "NEXT_PUBLIC_API_URL não configurada.");

  const { data } = await supabase().auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new ApiError(401, "Sessão expirada. Entre novamente.");

  let res: Response;
  try {
    res = await fetch(`${base.replace(/\/$/, "")}${path}`, {
      ...init,
      headers: { ...(init.body ? { "Content-Type": "application/json" } : {}), Authorization: `Bearer ${token}` },
    });
  } catch {
    throw new ApiError(0, "Não foi possível falar com o servidor.");
  }
  if (!res.ok) {
    const corpo = (await res.json().catch(() => null)) as { erro?: unknown; regra?: unknown; erros?: unknown; alertas?: unknown } | null;
    throw new ApiError(res.status, typeof corpo?.erro === "string" ? corpo.erro : `Erro ${res.status}`, {
      regra: typeof corpo?.regra === "string" ? corpo.regra : undefined,
      erros: lista(corpo?.erros),
      alertas: lista(corpo?.alertas),
    });
  }
  return (await res.json()) as T;
}

export const api = <T>(path: string) => chamar<T>(path);

/** POST com corpo JSON. */
export const apiPost = <T>(path: string, corpo: unknown) => chamar<T>(path, { method: "POST", body: JSON.stringify(corpo) });

/** PUT com corpo JSON. */
export const apiPut = <T>(path: string, corpo: unknown) => chamar<T>(path, { method: "PUT", body: JSON.stringify(corpo) });
