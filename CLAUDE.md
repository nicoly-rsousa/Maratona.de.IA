# Farol — contexto para vibe coding

Priorizador de OS de manutenção de rede elétrica. Fonte de verdade das regras: `docs/REGRADENEGOCIO.md`.
Protótipo de referência (UI/fluxos): `docs/farol.html`.

## Stack
- `packages/shared`: tipos Zod + motor de priorização PURO (sem I/O). Usado pela API e pelo front.
- `apps/api` (Render): Fastify + Supabase (service_role). **Todo filtro de cidade/perfil é no servidor.**
- `apps/web` (Vercel): Next.js + Tailwind (tokens em `globals.css`, sem shadcn/ui) + TanStack Query + react-leaflet. Fala só com a API e com Supabase Auth.
- `supabase/`: migrations SQL (RLS como defesa em profundidade).

## Regras de ouro
1. Nenhum peso, faixa, prazo ou regra no código: tudo vem do banco (valores atuais são DEMONSTRATIVOS).
2. Informação desconhecida NÃO é risco zero. `pontos = null` ≠ 0 e bloqueia a publicação.
3. `resultados_prioridade`, versões publicadas e `auditoria` são imutáveis.
4. Mudou regra do motor? Atualize/adicione teste em `packages/shared/src/priority.test.ts` ANTES.
5. `SUPABASE_SERVICE_ROLE_KEY` nunca vai para o front.
6. Antes de dar uma tarefa por concluída: `npm test && npm run typecheck`.
7. Itens ND01–ND07 do relatório são indefinidos: configuráveis, nunca fixos.
Farol v2 — leitura obrigatória antes de desenvolver

Antes de qualquer alteração relacionada a alimentador, proximidade, mapa ou importação de dados, leia nesta ordem:

docs/requisitos-farol-v2.md — o que construir, decisões já tomadas e pontos em aberto.
REGRADENEGOCIO.md — regras já implementadas; não quebrar a ordem da fila nem as camadas A e B.
docs/dados/DICIONARIO-DADOS.md — formatos, armadilhas e ligações entre as bases.

Regras que valem sempre:

Proximidade geográfica nunca altera a prioridade nem a ordem da fila; só gera sugestão.
Itens marcados [A CONFIRMAR] não são decisão: implemente como parâmetro configurável e pergunte antes de fixar.
Não versionar nem importar dados pessoais de clientes. Os CSV de docs/dados ficam fora do Git.
Migrações novas em supabase/; nunca editar migração já aplicada.
Ao terminar cada etapa, rode os testes e confira os critérios de aceite da seção 7 do requisitos.