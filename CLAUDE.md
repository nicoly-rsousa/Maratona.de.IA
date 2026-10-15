# Farol — contexto para vibe coding

Priorizador de OS de manutenção de rede elétrica. Fonte de verdade das regras: `docs/REGRADENEGOCIO.md`.
Protótipo de referência (UI/fluxos): `docs/farol.html`.

## Stack
- `packages/shared`: tipos Zod + motor de priorização PURO (sem I/O). Usado pela API e pelo front.
- `apps/api` (Render): Fastify + Supabase (service_role). **Todo filtro de cidade/perfil é no servidor.**
- `apps/web` (Vercel): Next.js + Tailwind + shadcn/ui + TanStack Query + react-leaflet. Fala só com a API e com Supabase Auth.
- `supabase/`: migrations SQL (RLS como defesa em profundidade).

## Regras de ouro
1. Nenhum peso, faixa, prazo ou regra no código: tudo vem do banco (valores atuais são DEMONSTRATIVOS).
2. Informação desconhecida NÃO é risco zero. `pontos = null` ≠ 0 e bloqueia a publicação.
3. `resultados_prioridade`, versões publicadas e `auditoria` são imutáveis.
4. Mudou regra do motor? Atualize/adicione teste em `packages/shared/src/priority.test.ts` ANTES.
5. `SUPABASE_SERVICE_ROLE_KEY` nunca vai para o front.
6. Antes de dar uma tarefa por concluída: `npm test && npm run typecheck`.
7. Itens ND01–ND07 do relatório são indefinidos: configuráveis, nunca fixos.
