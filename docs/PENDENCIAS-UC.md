# Pendências do ajuste de UC (branch `feature/uc`)

Bloqueio atual: `apps/api/.env` tem `SUPABASE_URL` corrompida (sem esquema/host válido — ver histórico da
conversa). Enquanto isso não for corrigido, nada que precise do Supabase local pôde ser executado nesta
branch. Ninguém tocou em `apps/api/.env` nem tentou adivinhar a URL/chave certa.

## O que falta rodar (depende do banco)

1. **Corrigir `apps/api/.env`** — `SUPABASE_URL` precisa ser a URL completa (`https://<ref>.supabase.co`)
   do mesmo projeto da `SUPABASE_SERVICE_ROLE_KEY` que já está no arquivo. Confirmar com
   `curl $SUPABASE_URL/auth/v1/settings -H "apikey: $SUPABASE_SERVICE_ROLE_KEY"` (não deve dar "Invalid API key").
2. **Aplicar a migration `supabase/migrations/0008_unidades_consumidoras.sql`** no projeto Supabase local/dev
   (painel SQL ou `supabase db push`, conforme o fluxo que vocês já usam para 0001–0007).
3. **Rodar o import real** (a planilha fictícia não tem coluna de cidade — por isso `--cidade=RP` fixo,
   a mesma cidade demonstrativa criada pela 0008):
   ```
   npm run import:ucs -w @farol/api -- --file="docs/dados/Experimento_Dados_Ficticios - BASE CLIENTES 1.xlsx" --cidade=RP
   ```
   (sem `--dry-run`). O dry-run já foi validado nesta sessão: 200/200 linhas da planilha fictícia válidas,
   0 fora do raio de 100 km do centro de RP, nenhuma coluna fora da lista aprovada foi usada.
4. **Vincular os usuários de teste à cidade RP** (sem criar usuário nenhum — só liga quem já existe pelo
   e-mail usado no `scripts/smoke.mjs`; roda depois da 0008 aplicada):
   ```sql
   insert into usuario_cidades (user_id, cidade_id)
   select u.id, 'RP'
   from auth.users u
   where u.email in (
     'atendente@farol.teste', 'despachante@farol.teste', 'supervisor@farol.teste',
     'campo@farol.teste', 'chave@farol.teste'
   )
   on conflict (user_id, cidade_id) do nothing;
   ```
   (Administrador e Supervisor já enxergam todas as cidades por perfil — o insert acima não atrapalha
   mesmo que rode pra eles também, por isso a lista não os exclui.)
5. **Smoke "antes"**: não há um resultado "antes" desta sessão porque o `.env` já estava quebrado quando a
   tarefa começou. Use como referência o último resultado conhecido e registrado no repositório:
   **`npm test` → 167/167** (reconfirmado nesta sessão, sem mudança) e o smoke completo relatado
   anteriormente como **47/47** (não reexecutado agora por falta de `.env` válido).
6. **Smoke "depois"**: depois dos passos 1–4, rodar:
   ```
   node scripts/smoke.mjs
   ```
   com a API local no ar (`npm run dev:api`) e comparar com o "antes" acima — nenhuma linha que hoje passa
   pode passar a falhar, e as 9 OS dos cenários CR-01..CR-04 devem manter a mesma ordem. A cidade nova (RP)
   não deve aparecer no smoke atual (ele não testa RP), então o resultado esperado é idêntico ao "antes".

## Como rodar o smoke na `main`, sem perder o trabalho da branch

A migration 0008 e o `import-ucs.ts` só existem em `feature/uc` (branch nova, sem merge feito). Para rodar o
smoke "como estava antes", sem perder nada:

```bash
git stash push -u -m "wip feature/uc"   # só se houver mudança não commitada no momento
git checkout main
node scripts/smoke.mjs                  # smoke "antes", usando o schema sem 0008
git checkout feature/uc
git stash pop                           # se usou o stash acima
```

Isso funciona porque `0008_unidades_consumidoras.sql` só é aplicada manualmente (passo 2 acima); o banco
em si não muda de branch. Ou seja, mesmo sem trocar de branch, rodar o smoke contra o banco **antes** de
aplicar a 0008 já é equivalente a "smoke na main".

## O que está pronto, independente do banco

- Migration `0008_unidades_consumidoras.sql` escrita e revisável (ver mensagem anterior).
- `apps/api/src/import-ucs.ts` com `--dry-run` funcional (testado nesta sessão contra a planilha fictícia,
  incluindo a trava de distância de 100 km e a normalização de `situacao` para ATIVO/INATIVO).
- `npm test` (167/167), `npm run typecheck` e `npm run build:api` / `npm run build:web` continuam passando,
  sem nenhuma mudança em `packages/shared` (motor de priorização intocado) — ver tabela de status na
  resposta desta tarefa.

## Pendência de design (não é bloqueio técnico, é decisão de produto)

`ordens_servico.uc` e `solicitacoes.uc` continuam com o check fixo `^\d{6,10}$` gravado nas migrations
0001/0002 — isso **não muda** com a 0008. Se algum dia `configuracoes.uc.formato_regex` for alterado (por
exemplo, pra aceitar UC de 5 dígitos), o cadastro `unidades_consumidoras` passa a aceitar o novo formato
(porque lê a config via trigger), mas a abertura de OS continua exigindo 6–10 dígitos (porque o check de
`ordens_servico`/`solicitacoes` é fixo, não lê a config). Os dois ficam fora de sincronia até uma migration
própria trocar aquele check fixo por um trigger igual ao de `unidades_consumidoras` — isso está fora do
escopo dos Lotes 1–3 e não foi feito.
