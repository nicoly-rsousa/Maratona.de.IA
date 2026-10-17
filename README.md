# Farol

Priorizador de ordens de serviço (OS) de manutenção de rede elétrica. A regra de negócio vive em
[`docs/REGRADENEGOCIO.md`](docs/REGRADENEGOCIO.md); o protótipo de referência dos fluxos em
[`docs/farol.html`](docs/farol.html) (a identidade visual atual está em [`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md));
o contexto para vibe coding em [`CLAUDE.md`](CLAUDE.md).

> **Pontos, faixas, prazos e regras de precedência são DEMONSTRATIVOS e não oficiais** (ND01–ND07 do relatório estão
> indefinidos). Nada disso está no código: vive no banco e é publicado pelo Usuário Chave / cadastrado pelo administrador.

## Estrutura

| Pasta | O que é |
|---|---|
| `packages/shared` | Tipos Zod e motor de priorização **puros** (sem I/O), usados pela API e pelo front: pontuação, fila, status, duplicidade, despacho, versões, mapa, cenários |
| `apps/api` | Fastify + Supabase (`service_role`) no Render. **Todo filtro de cidade e de perfil é no servidor** |
| `apps/web` | Next.js + TanStack Query + Leaflet no Vercel; CSS em BEM sobre design tokens, Tailwind só para layout, ícones Material UI. Fala só com a API e com o Supabase Auth |
| `supabase/` | Migrations SQL (RLS como defesa em profundidade) e `seed.sql` |
| `docs/` | Regra de negócio, design system, roteiros de teste, de demonstração e de deploy |
| `scripts/` | `smoke.mjs` (API e site no ar) e `contraste.mjs` (contraste WCAG dos tokens) |

## O que está pronto

- **Fila por cidade** (§2) com "por que esta prioridade": pontos por critério, regras aplicadas, motivo, histórico de resultados imutáveis.
- **Nova solicitação** com sugestão de duplicidade (§11), vínculo a OS existente, escolha do ponto no mapa e status inicial por localização.
- **Status e despacho** (§9, §10): transições validadas no banco, recomendação por compatibilidade e disponibilidade antes da distância, capacidade nunca ultrapassada, 409 em designações concorrentes, ciclo aceite → início → conclusão, reabertura pelo supervisor.
- **Pontuação do Usuário Chave** (§5): rascunho com `etag` (409), validação com erros e alertas, publicação com justificativa, vigência e modo explícito (novas × reclassificar), aprovação opcional por um segundo usuário, restaurar como novo rascunho. Cada OS fica na versão com que foi calculada.
- **Reclassificação automática** (§7) a cada 60 s, sempre com a versão da OS; migra só com versão publicada em modo "reclassificar".
- **Mapa** (Leaflet/OpenStreetMap): OS por prioridade, equipes, raio de duplicidade, distância **em linha reta** (sem rota nem tempo).
- **Precedência** (camada A): o Administrador edita as regras, pré-visualiza o impacto nas OS abertas e confirma com justificativa; cada gravação é uma versão nova que reclassifica as abertas. Os demais perfis com acesso só consultam.
- **Perfis e cidades** (§8, §13): escopo de cidade no servidor, 403 + auditoria fora dele.
- **Cenários de referência CR-01 a CR-04** do relatório (seção 12) como testes e como dados de demonstração.

## Rodar local

### Com um comando (Supabase local no Docker)

Requisitos: Node 22 e Docker Desktop (no Windows, com WSL 2).

```bash
npm install
npm run dev        # Docker → Supabase local → banco → API (:3001) e site (:3000); abre o navegador
```

`npm run dev` (`scripts/iniciar.mjs`) abre o Docker Desktop se precisar, sobe o Supabase local (`npx supabase start`;
a 1ª vez baixa as imagens), roda `npm run db:local` e inicia API e site no mesmo terminal. Ctrl+C encerra API e site;
o Supabase continua no ar (`npx supabase stop` desliga). Opções: `--sem-banco`, `--sem-navegador`
(ex.: `npm run dev -- --sem-banco`).

`npm run db:local` (`scripts/db-local.mjs`, idempotente, só fala com `127.0.0.1`) aplica `0001 → seed.sql → 0002 … 0007`
nessa ordem (por isso o `supabase/config.toml` desliga a aplicação automática do CLI), cria os usuários de teste
(`admin`, `atendente`, `despachante`, `supervisor`, `campo`, `chave` — todos `@farol.teste`), grava `apps/api/.env` e
`apps/web/.env.local` com as chaves do Supabase **local** e roda os seeds. A senha dos usuários é gerada e mostrada uma
única vez (ou defina `FAROL_SENHA_TESTE` antes); ela não fica gravada em arquivo.

### Com um projeto Supabase na nuvem

Requisitos: Node 22. Projeto Supabase com o banco montado (próxima seção).

```bash
npm install
cp apps/api/.env.example apps/api/.env             # SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CORS_ORIGIN
cp apps/web/.env.example apps/web/.env.local       # NEXT_PUBLIC_API_URL, NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
npm run dev:api                                    # http://localhost:3001  (GET /health)
npm run dev:web                                    # http://localhost:3000
```

Antes de entregar uma tarefa: `npm test && npm run typecheck` (e, para o que vai ao ar, `npm run build:web` e `npm run build:api`;
mexeu em cores, `npm run check:contrast`). `SUPABASE_SERVICE_ROLE_KEY` nunca vai para o front.

## Interface

Tema claro por padrão, com alternância para o escuro (salva em `localStorage`, chave `farol-tema`). Paleta-base
[Homework](https://lospec.com/palette-list/homework) em design tokens (`apps/web/src/styles/tokens.css`), classes próprias em
BEM, ícones `@mui/icons-material` e meta de acessibilidade WCAG 2.2 AA. Convenções, tokens, contrastes e componentes:
[`docs/DESIGN-SYSTEM.md`](docs/DESIGN-SYSTEM.md).

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
| 7 | `supabase/migrations/0006_regras_edicao.sql` | edição das regras de precedência com versão, justificativa e reclassificação |
| 8 | `supabase/migrations/0007_regras_minimo.sql` | exige ao menos uma regra de precedência no conjunto (desativar continua permitido) |

Depois, os dados demonstrativos (a API precisa estar configurada com o `.env`):

```bash
npm run seed       # versão de pontuação v1 demonstrativa (global)
npm run seed:os    # 11 OS do protótipo (BH e CT)
npm run seed:cr    # OS dos cenários CR-01 a CR-04 em BH (demo=true, idempotente)
```

Usuários de teste (um por perfil): crie as contas em Authentication e rode `docs/usuarios-de-teste.sql`.
Ajustes em `configuracoes`: `pontuacao.max_pontos` (padrão 100) e `pontuacao.exigir_aprovacao` (padrão `false`).

## Subir no ar

Supabase (SQLs acima e usuários) → Render (`render.yaml`, plano `starter`) → Vercel (Root Directory `apps/web`) → CORS.
O passo a passo completo, com variáveis e testes finais, está em [`docs/DEPLOY.md`](docs/DEPLOY.md).

Os scripts `npm run seed*` usam `tsx --env-file=.env`, que só existe na máquina local: rode-os localmente com o `.env`
apontando para o banco de destino. O build do Render embute só a versão v1 (`apps/api/dist/seed.js`, entrada do
`tsup.config.ts`); no Shell do serviço, onde as variáveis já estão definidas, o equivalente é `node apps/api/dist/seed.js`.

## Testes e roteiros

| Quê | Onde |
|---|---|
| Motor, fila, status, duplicidade, despacho, versões, mapa, regras | `npm test` (`packages/shared/src/*.test.ts`) |
| Contraste WCAG 2.2 AA dos tokens (claro e escuro) | `npm run check:contrast` |
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
- **Outros itens do §7 e §8**: reclassificação por revisão manual e troca de município, administração de cidades, tela de auditoria.
- **Tempo de rota/estimativa**: só distância em linha reta; serviço de rotas não integrado.
- **Qualidade do front**: não há ESLint nem testes automatizados de componentes/telas no `apps/web` (só `typecheck` e `build`).
