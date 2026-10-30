// Valores neutros só para o env.ts validar; nada é conectado nos testes unitários (db é simulado).
process.env.SUPABASE_URL ??= "http://127.0.0.1:54321";
process.env.SUPABASE_SERVICE_ROLE_KEY ??= "chave-de-teste-nao-e-real-0000000000";
