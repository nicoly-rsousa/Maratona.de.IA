# Farol

Monorepo: `packages/shared` (motor) · `apps/api` (Render) · `apps/web` (Vercel, próximo passo) · `supabase/`.

## Rodar local
```bash
npm install
npm test                       # 14 testes do motor (CR01, fila, versões, status)
cp apps/api/.env.example apps/api/.env   # preencha com as chaves do Supabase
npm run dev:api
```

## Subir no ar (ordem)
1. **Supabase**: crie o projeto → SQL Editor → rode `supabase/migrations/0001_init.sql` e depois `supabase/seed.sql`.
   Authentication → crie os usuários e insira cada um em `perfis` (e `usuario_cidades`).
2. **Render**: New → Blueprint → aponte para este repo (`render.yaml`). Preencha `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`, `CORS_ORIGIN`. Depois, no Shell do serviço: `npm run seed -w @farol/api`.
3. **Vercel** (quando o front existir): Root Directory `apps/web`; variáveis
   `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## Roadmap de vibe coding (um prompt por etapa)
1. ✅ Motor de priorização + fila + validação de versões + status (testado)
2. ✅ Schema Supabase + RLS + API: `/health`, `/me`, `GET /os/fila`, `POST /os`
3. Front: login (Supabase Auth) + fila por cidade + detalhe da OS com "por que esta prioridade"
4. Nova solicitação (formulário) + sugestão de duplicidade (§11)
5. Tela do Usuário Chave: rascunho → validação → publicar (somente novas / reclassificar)
6. Despacho: recomendação por compatibilidade/disponibilidade, 409 em concorrência (§9)
7. Mapa (Leaflet) + importação de planilha do SGM
8. Auditoria, regras de precedência (admin) e cenários CR01–CR04 como testes de ponta a ponta
