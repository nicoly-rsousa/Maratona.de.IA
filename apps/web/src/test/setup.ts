import { afterEach } from "vitest";
import { cleanup, configure } from "@testing-library/react";

// Sem `globals: true`, o Testing Library não limpa o DOM sozinho entre os testes.
afterEach(() => cleanup());

// Variáveis que lib/api.ts e lib/supabase.ts leem; valores neutros, nada é conectado nos testes.
process.env.NEXT_PUBLIC_API_URL ??= "http://api.teste.invalid";

// A máquina local pode ficar lenta (Docker, Studio): findBy*/waitFor esperam mais antes de desistir.
configure({ asyncUtilTimeout: 5000 });
