# Farol

Priorizador de ordens de serviço (OS) de manutenção de rede elétrica. A regra de negócio vive em
[`docs/REGRADENEGOCIO.md`](docs/REGRADENEGOCIO.md); o protótipo de referência (UI e fluxos) em
[`docs/farol.html`](docs/farol.html); o contexto para vibe coding em [`CLAUDE.md`](CLAUDE.md).

> **Pontos, faixas, prazos e regras de precedência são DEMONSTRATIVOS e não oficiais** (ND01–ND07 do relatório estão
> indefinidos). Nada disso está no código: vive no banco e é publicado pelo Usuário Chave / cadastrado pelo administrador.

## Estrutura

| Pasta | O que é |
|---|---|
| `packages/shared` | Tipos Zod e motor de priorização **puros** (sem I/O), usados pela API e pelo front: pontuação, fila, status, duplicidade, despacho, versões, mapa, cenários |
| `apps/api` | Fastify + Supabase (`service_role`) no Render. **Todo filtro de cidade e de perfil é no servidor** |
| `apps/web` | Next.js + Tailwind + TanStack Query + Leaflet no Vercel. Fala só com a API e com o Supabase Auth |
| `supabase/` | Migrations SQL (RLS como defesa em profundidade) e `seed.sql` |
| `docs/` | Regra de negócio, roteiros de teste e de demonstração |

## O que está pronto

- **Fila por cidade** (§2) com "por que esta prioridade": pontos por critério, regras aplicadas, motivo, histórico de resultados imutáveis.
- **Nova solicitação** com sugestão de duplicidade (§11), vínculo a OS existente, escolha do ponto no mapa e status inicial por localização.
- **Status e despacho** (§9, §10): transições validadas no banco, recomendação por compatibilidade e disponibilidade antes da distância, capacidade nunca ultrapassada, 409 em designações concorrentes, ciclo aceite → início → conclusão, reabertura pelo supervisor.
- **Pontuação do Usuário Chave** (§5): rascunho com `etag` (409), validação com erros e alertas, publicação com justificativa, vigência e modo explícito (novas × reclassificar), aprovação opcional por um segundo usuário, restaurar como novo rascunho. Cada OS fica na versão com que foi calculada.
- **Reclassificação automática** (§7) a cada 60 s, sempre com a versão da OS; migra só com versão publicada em modo "reclassificar".
- **Mapa** (Leaflet/OpenStreetMap): OS por prioridade, equipes, raio de duplicidade, distância **em linha reta** (sem rota nem tempo).
- **Precedência**: consulta das regras da camada A (somente leitura).
- **Perfis e cidades** (§8, §13): escopo de cidade no servidor, 403 + auditoria fora dele.
- **Cenários de referência CR-01 a CR-04** do relatório (seção 12) como testes e como dados de demonstração.

## Rodar local

Requisitos: Node 22. Projeto Supabase com o banco montado (próxima seção).

```bash
npm install
cp apps/api/.env.example apps/api/.env             # SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CORS_ORIGIN
cp apps/web/.env.example apps/web/.env.local       # NEXT_PUBLIC_API_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
npm run dev:api                                    # http://localhost:3001  (GET /health)
npm run dev:web                                    # http://localhost:3000
```

Antes de entregar uma tarefa: `npm test && npm run typecheck` (e, para o que vai ao ar, `npm run build:web` e `npm run build:api`).
`SUPABASE_SERVICE_ROLE_KEY` nunca vai para o front.

## Banco: ordem dos SQLs

No SQL Editor do Supabase, **nesta ordem** (cada migration é idempotente, exceto a 0001):

| # | Arquivo | O que faz |
|---|---|---|
| 1 | `supabase/migrations/0001_init.sql` | schema inicial, versões de pontuação, regras, OS, resultados, despachos, auditoria |
| 2 | `supabase/seed.sql` | cidades (BH, CT), equipes e regras de precedência demonstrativas |
| 3 | `supabase/migrations/0002_solicitacoes.sql` | solicitações, vínculo, dados de localização |
| 4 | `supabase/migrations/0003_endurecimento.sql` | RLS, privilégios, checks e `search_path` |
| 5 | `supabase/migrations/0004_status_despacho.sql` | status e despacho transacionais, eventos |
| 6 | `supabase/migrations/0005_pontuacao.sql` | `configuracoes` e funções de rascunho, publicação, aprovação e restauração |
| 7 | `supabase/migrations/0006…0007` | edição de regras e mínimos (ver o cabeçalho de cada arquivo) |
| 8 | `supabase/migrations/0008_rede_geo.sql` | Farol v2: PostGIS, circuitos, chaves, transformadores, regional, OS importadas, sugestões de carona |
| 9 | `supabase/migrations/0009_rede_tracado.sql` | Farol v2: traçado dos alimentadores, configuração do mapa/raio e funções de consulta |

Depois, os dados demonstrativos (a API precisa estar configurada com o `.env`):

```bash
npm run seed       # versão de pontuação v1 demonstrativa (global)
npm run seed:os    # 11 OS do protótipo (BH e CT)
npm run seed:cr    # OS dos cenários CR-01 a CR-04 em BH (demo=true, idempotente)
```

Usuários de teste (um por perfil): crie as contas em Authentication e rode `docs/usuarios-de-teste.sql`.
Ajustes em `configuracoes`: `pontuacao.max_pontos` (padrão 100) e `pontuacao.exigir_aprovacao` (padrão `false`).

## Teste local do Farol v2 (rede, traçado e mapa) com Docker

Tudo roda num Supabase **local**, sem tocar em nenhum banco remoto. O importador (`scripts/importar-v2`) só aceita gravar
quando `SUPABASE_URL` aponta para `127.0.0.1` ou `localhost` (portas 54321/54322); qualquer outro host, inclusive `supabase.co`,
aborta antes de ler arquivos ou abrir conexão.

1. **Docker Desktop** instalado e em execução.
2. **Iniciar o Supabase local** (a primeira vez baixa as imagens; use `npx supabase init` antes se ainda não houver `supabase/config.toml`, sem sobrescrever as migrations):
   ```bash
   npx supabase start
   npx supabase status -o env      # mostra API_URL e SERVICE_ROLE_KEY locais
   ```
3. **Credenciais locais**: `cp .env.docker.example .env.docker` e cole a `SERVICE_ROLE_KEY` local. O arquivo `.env.docker` está no `.gitignore`.
4. **Montar o banco local** (aplica `supabase/migrations/*` em ordem, incluindo 0008 e 0009, e depois `seed.sql`):
   ```bash
   npx supabase db reset           # APAGA e recria o banco LOCAL
   ```
5. **Teste SQL da busca por raio** (transação com ROLLBACK, não deixa nada no banco):
   ```bash
   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -v ON_ERROR_STOP=1 -f supabase/tests/rede_raio.sql
   ```
6. **Importar** os dados de `docs/dados` (ficam só na sua máquina; nada de dado pessoal sai do script). Primeiro o modo de teste, sem banco:
   ```bash
   npm run importar:v2                                              # relatório de qualidade, não grava
   node --env-file=.env.docker scripts/importar-v2/importar.mjs --gravar   # grava no banco LOCAL
   node --env-file=.env.docker scripts/importar-v2/importar.mjs --atualizar-regional --gravar   # só regional.csv → tabela regional
   ```
7. **Testes**: `npm test && npm run test:importar && npm run typecheck`.

Para parar: `npx supabase stop`. `docs/dados` (CSV, XLSX, traçado) e `.env.docker` nunca vão para o Git.

## Subir no ar

1. **Supabase**: SQLs acima e usuários.
2. **Render**: New → Blueprint → este repo (`render.yaml`). Preencha `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CORS_ORIGIN`.
   O plano precisa ser pago (`starter`): o gratuito dorme e a reclassificação de 60 s para. Depois rode `npm run seed` no Shell do serviço.
3. **Vercel**: Root Directory `apps/web`; variáveis `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

## Testes e roteiros

| Quê | Onde |
|---|---|
| Motor, fila, status, duplicidade, despacho, versões, mapa | `npm test` (`packages/shared/src/*.test.ts`) |
| Cenários CR-01 a CR-04 explicados | `packages/shared/src/cenarios.test.ts` |
| Demonstração de 8 a 10 minutos, tela por tela | [`docs/ROTEIRO-DEMO.md`](docs/ROTEIRO-DEMO.md) |
| Concorrência do despacho (409) | [`docs/teste-concorrencia.md`](docs/teste-concorrencia.md) |
| Concorrência do rascunho, aprovação, migração de versão | [`docs/teste-pontuacao.md`](docs/teste-pontuacao.md) |
| Segurança do banco (anon não lê nem grava) | [`docs/verificacao-seguranca.md`](docs/verificacao-seguranca.md) |

## Pendências (o que ainda **não** existe)

- **Critérios do §4**: a v1 tem 8 critérios e cobre 7 dos 19 do §4. Faltam 12, e os critérios personalizados do administrador.
  Lista e dependências em [`docs/criterios-v1-pendentes.md`](docs/criterios-v1-pendentes.md).
- **Prazos (§6)**: os cinco prazos por código (triagem, despacho, início, restabelecimento, conclusão), calendário corrido e útil e o "prazo corrente" por status. Hoje a OS só tem o prazo-limite informado, que alimenta o critério "Prazo-limite".
- **Unificação (§11)**: o supervisor unir duas OS (migrar solicitações, mesclar fatos, reclassificar a principal). O vínculo de uma nova solicitação a uma OS existente já funciona.
- **Dados de localização e rede (§12)**: transformador (3 primeiros dígitos = localidade, aviso de localidade não cadastrada), conjunto pertencente ao circuito e origem derivada no servidor, coordenadas em link de mapa e graus/minutos/segundos, alerta fora do Brasil ou do raio do município, consulta de UC auditada com nome mascarado (LGPD) e "não sabe a UC" com motivo. Hoje há só validação de formato (transformador 4–12 dígitos, UC 6–10) e coordenadas em graus decimais.
- **Importação de planilha do SGM**.
- **Edição das regras de precedência** (administrador, com justificativa e versão); a tela é somente leitura.
- **Outros itens do §7 e §8**: reclassificação por revisão manual e troca de município, administração de cidades, tela de auditoria.
- **Tempo de rota/estimativa**: só distância em linha reta; serviço de rotas não integrado.
