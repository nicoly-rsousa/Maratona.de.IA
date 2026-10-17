# Farol — Revisão pré-produção

Revisão de código, somente leitura. Nenhum arquivo de código foi alterado, nenhum SQL foi aplicado, nenhuma configuração do Render/Vercel/Supabase foi mudada. Toda evidência é citada como `arquivo:linha` ou como a consulta/teste que a produziu. Onde não consegui confirmar, está escrito "não verificado" com o motivo — nada foi inventado.

**Acesso que tive nesta revisão:** leitura do repositório e do histórico `git`; consultas de leitura (`select`) contra o Supabase do projeto usando a chave `service_role` de `apps/api/.env` e a chave pública `anon` de `apps/web/.env.local` (os dois arquivos já existiam no disco; não imprimo os valores); a API local rodando em `127.0.0.1:3001`; `npm audit`. **Não tive** acesso ao MCP do Supabase (o servidor configurado em `.mcp.json` exige autorização interativa que não está disponível nesta sessão) — por isso os Advisors de segurança/desempenho e a listagem oficial de políticas/grants estão como "não verificado", compensados por testes de leitura/escrita reais contra o banco (abaixo).

---

## 1. Veredito

**Demonstração publicada, com dados fictícios:** **PRONTO COM RESSALVAS.**
O motor de prioridade, a fila, o despacho, a pontuação e a precedência funcionam de ponta a ponta, com RLS, auditoria e imutabilidade confirmadas ao vivo (seção 9). As ressalvas são operacionais, não de lógica: nada deste repositório está publicado hoje (nem Render nem Vercel — confirmado nesta sessão), o cadastro público do Supabase Auth está aberto, e a UC trafega sem mascaramento. Resolvendo P-01, P-05 e publicando com os usuários `@farol.teste`, é seguro mostrar.

**Produção real (clientes e dados verdadeiros):** **NÃO PRONTO.**
Faltam partes inteiras das regras de negócio (§4 critérios, §6 prazos escalonados, §8 troca de município, §11 unificação), a UC não é mascarada nem a consulta bem-sucedida é auditada (§12, LGPD), a criação de OS não é transacional, e não há nenhum teste automatizado da API nem do front (só do motor puro em `packages/shared`). Pesos, faixas e prazos continuam demonstrativos (ND01–ND07), como o próprio projeto já documenta.

---

## 2. Bloqueadores (corrigir antes de subir)

| ID | Área | Descrição | Evidência | Risco | Correção | Esforço |
|---|---|---|---|---|---|---|
| P-01 | Deploy | Nada deste repositório está publicado: sem projeto na Vercel (`list_projects` vazio, checado nesta sessão) e sem serviço no Render (os únicos serviços da conta são de outro repositório, `Maratona-RPV---PRIORIZA-O`, não deste) | Checagem ao vivo nesta sessão (Vercel e Render) | Sem isso, não há "produção" para revisar de verdade | Criar o projeto Vercel (Root Directory `apps/web`) e o serviço Render a partir de `render.yaml`; ver checklist §5 | M |
| P-02 | LGPD / API | UC trafega sem mascaramento e a consulta **bem-sucedida** de uma OS não é auditada (só o acesso **negado** é) | `apps/api/src/routes/os.ts:104` e `:149` (UC na resposta); zero ocorrência de "mascar"/"mask" em `apps/api/src`, `apps/web/src`, `packages/shared/src`; `apps/api/src/routes/os.ts` — `GET /os/:id` só chama `auditar()` nas linhas 70 e 75 (ambas "negado"), nunca no caminho de sucesso | Descumpre §12 ("consulta auditada e nome mascarado") de forma direta e verificável | Mascarar a UC na resposta (ex.: mostrar só os 2 últimos dígitos) salvo quando o perfil precisa do valor completo; `auditar()` também no sucesso de `GET /os/:id` quando a OS tem UC | P/M |
| P-03 | LGPD / API | `GET /os/fila` e `GET /os/:id` devolvem a linha inteira (endereço, UC, transformador, latitude/longitude) para **qualquer perfil com `consultar`**, inclusive o Usuário Chave, que só deveria configurar pontuação | `apps/api/src/routes/os.ts:33` (`select("*")` na fila); comparar com `apps/api/src/routes/mapa.ts:25-38`, que já devolve só `id, numero, cidade_id, lat, lng, codigo, nivel, status, tipo` — a própria equipe já resolveu isso para o mapa, não para a fila | Usuário Chave sem motivo operacional acessando endereço/UC de OS (LGPD, minimização) | Um DTO mais enxuto para quem só tem `consultar` sem `designar`/`status`/`campo`, no mesmo padrão já usado em `/mapa` | P/M |
| P-04 | API | Criação de OS não é transacional: `ordens_servico`, `resultados_prioridade` e `solicitacoes` são três `insert` separados; se o 2º ou 3º falhar, a OS fica inconsistente (sem resultado ou sem a solicitação de abertura), só com uma mensagem de erro explicando o que faltou | `apps/api/src/services/os.ts:44-69` (comentários próprios do arquivo já admitem a limitação de transação do `supabase-js`) | OS sem `resultados_prioridade` quebra a fila (o código em cache de `ordens_servico` existe, mas o histórico fica incompleto) e nenhuma reconciliação automática existe | Função `criar_os(p_dados jsonb, ...)` no Postgres, nos mesmos moldes de `salvar_regras`/`designar_equipe` (uma transação, já com o padrão de erro `FD4xx`/`FD5xx` em uso no projeto) | M |
| P-05 | Supabase Auth | Cadastro público está **aberto** (`disable_signup: false`), num app cujo modelo é só de usuários pré-cadastrados por um Administrador | `GET {SUPABASE_URL}/auth/v1/settings` com a `service_role` (consulta ao vivo nesta sessão): `"disable_signup": false`, `"mailer_autoconfirm": false` | Qualquer pessoa com a URL do projeto e a chave `anon` (ambas públicas por desenho, vão para o navegador) pode criar uma conta no Supabase Auth. A conta fica sem `perfis` e a API nega com 403 "Usuário sem perfil" (`apps/api/src/auth.ts` — `autenticar()`), então ninguém entra no sistema; mas a conta é criada mesmo assim (consome e-mail, fica órfã em `auth.users`) | Desligar "Allow new users to sign up" no painel do Supabase (Authentication → Settings) | P |
| P-06 | Testes / CI | `apps/api` e `apps/web` não têm **nenhum** teste automatizado, e não há pipeline de CI | `find apps/api/src apps/web/src -iname "*.test.*" -o -iname "*.spec.*"` sem resultado; `package.json:6` — o script `test` da raiz só roda `@farol/shared`; `find . -iname "*.yml" -path "*workflows*"` sem resultado (nenhum `.github/workflows`) | Um PR pode quebrar uma rota, uma permissão ou uma tela inteira e nada barra antes do merge — só o `scripts/smoke.mjs`, que é manual | No mínimo: 1 teste de integração por rota crítica (permissão + escopo) em `apps/api`, e um workflow de CI rodando `npm test && npm run typecheck && npm run build:api && npm run build:web` em cada PR | M/G |

---

## 3. Importantes e melhorias

| ID | Área | Descrição | Evidência | Risco | Correção | Esforço |
|---|---|---|---|---|---|---|
| I-01 | Regras de negócio §4 | A versão de pontuação v1 implementa só ~8 dos ~19 critérios listados no §4 (faltam UCs afetadas, extensão da interrupção, duração estimada, tipo de ocorrência, equipamento afetado, abrangência geográfica, UCs ligadas ao transformador, redundância, equipe especializada, classe do cliente, situação do cliente); e não há botão nem rota para cadastrar um critério ou opção **nova** pela tela (só editar pontos dos que já existem) | `packages/shared/src/demo.ts` (8 critérios) vs `docs/REGRADENEGOCIO.md:38`; `grep -n "adicionar\|Adicionar" apps/web/src/app/(app)/pontuacao/editor.tsx apps/web/src/app/(app)/pontuacao/painel.tsx` sem resultado | §4 só parcialmente implementado; "critérios personalizados" do §4 não têm caminho de uso real | Tela de "novo critério" / "nova opção" (o modelo de dados em `ConteudoSchema` já aceita JSON livre, falta só a interface) | M |
| I-02 | Regras de negócio §6 | Só existe **um** prazo (`prazo_limite`), não os cinco estagiados (triagem, despacho, início, restabelecimento, conclusão); o calendário é sempre corrido, nunca "útil" (08h–18h, seg-sex) | `supabase/migrations/0001_init.sql:110` (`prazo_limite timestamptz`, singular); `packages/shared/src/priority.ts` — `fatosAutomaticos()` faz a conta em milissegundos corridos, sem calendário útil | §6 implementado parcialmente (1 de 5 prazos; sem calendário útil) | Modelar os 5 prazos (mesmo que alguns fiquem `null` por enquanto) e o calendário útil como função pura testável em `packages/shared` | G |
| I-03 | Regras de negócio §8 | "Troca de município" (permissão própria, justificativa, reclassificação com a versão da nova cidade) não existe no código | `grep -rln "trocar.*municipio\|trocar.*cidade\|troca_municipio"` sem resultado em `apps/api/src`, `apps/web/src`, `packages/shared/src` | §8 parcialmente implementado | Rota + função no banco, no padrão já usado para `designar_equipe`/`mudar_status` | M |
| I-04 | Regras de negócio §11 | "Unificação" de OS duplicadas (supervisor mescla duas OS) não existe; só a vinculação de solicitação (atendente) está implementada | `grep -rln "unificar\|unificação"` sem resultado | §11 parcialmente implementado (metade da seção) | Função transacional própria (cancelar a duplicada como "Unificada em…", migrar solicitações, mesclar fatos) | G |
| I-05 | Regras de negócio §12 | `circuito`/`conjunto` são texto livre, sem validar que o conjunto pertence ao circuito, e sem registrar a "origem" (não informado/informado/identificado/confirmado) que o §12 pede | `packages/shared/src/solicitacao.ts:83` (`circuito: opcional(z.string()...)`, sem relação com conjunto); nenhuma coluna de "origem" em `ordens_servico` (`supabase/migrations/0001_init.sql`) | §12 parcialmente implementado | Cadastro de circuitos/conjuntos (tabela) + validação; coluna de origem derivada no servidor | G |
| I-06 | CLAUDE.md regra de ouro | Os formatos de UC (`^\d{6,10}$`) e de transformador (`^\d{4,12}$`) estão fixos em constantes TypeScript, não na tabela `configuracoes`, contrariando a "regra de ouro 1" do próprio `CLAUDE.md` e o §14.3 ("formatos... são configuráveis") | `packages/shared/src/solicitacao.ts:69-70` (`TRANSFORMADOR_RE`, `UC_RE`) | Baixo risco funcional hoje (os valores batem com o §14.3), mas qualquer mudança de formato exige deploy de código, não só configuração | Mover os dois padrões para `configuracoes`, como já foi feito para `pontuacao.max_pontos` | P/M |
| I-07 | API | Sem `@fastify/rate-limit`, sem `@fastify/helmet` (cabeçalhos de segurança), sem `bodyLimit` explícito (fica no padrão do Fastify, 1 MB) e sem timeout de conexão explícito | `apps/api/src/server.ts` — só `@fastify/cors` está registrado; `grep -rn "rate-limit\|helmet\|bodyLimit\|connectionTimeout"` sem resultado | Uma rota autenticada sem limite de requisições pode ser abusada por uma conta válida; sem cabeçalhos como `X-Content-Type-Options` | Adicionar `@fastify/rate-limit` (por IP e por usuário) e `@fastify/helmet` | P |
| I-08 | API | O job de reclassificação (60 s) só evita sobreposição **dentro do mesmo processo** (`emAndamento`, uma promise reaproveitada); não há trava entre instâncias | `apps/api/src/jobs/reclassificar.ts` — comentário do próprio arquivo já assume "com 1 instância no Render isso basta" | Com mais de 1 instância (ex.: autoscaling), duas rodadas simultâneas podem gravar resultados duplicados para a mesma OS | Um advisory lock no Postgres (como já existe para `regras_precedencia` e `versoes_pontuacao`) envolvendo a rodada inteira, ou migrar para Render Cron Job único (o próprio comentário já sugere isso) | M |
| I-09 | Dependências | `npm audit --omit=dev`: 2 vulnerabilidades (1 alta, 1 moderada) — `postcss` abaixo de uma versão segura, trazido transitivamente pelo `next` instalado | `npm audit --omit=dev` (rodado nesta revisão): `postcss <=8.5.22`, correção exige `next@16` (breaking) | Baixo risco prático (CSS é só o do próprio projeto, nenhuma entrada do usuário passa por `postcss` em runtime) | Planejar a atualização para Next 16 numa janela própria, não às pressas | P/M |
| I-10 | Front | 2 links internos (`<Link target="_blank">`) sem `rel="noopener"` — todos os links **externos** (Google Maps, OpenStreetMap) já têm `rel="noopener noreferrer"` corretamente | `apps/web/src/app/(app)/nova/page.tsx:328`; `apps/web/src/app/(app)/precedencia/impacto.tsx:56` | Baixo (mesma origem, não há `window.opener` de terceiro em jogo) | Acrescentar `rel="noopener"` nos dois | P |
| I-11 | Front | Sessão (`access_token`/`refresh_token`) fica em `localStorage`, pelo padrão do `@supabase/supabase-js` (nenhuma configuração de storage alternativa) | `apps/web/src/lib/supabase.ts:14` (`createClient(URL, ANON)`, sem `auth.storage` customizado) | Qualquer XSS futuro conseguiria ler o token; hoje não há vetor de XSS encontrado (único `dangerouslySetInnerHTML` é uma string estática, sem interpolação — `apps/web/src/app/layout.tsx:18`) | Nenhuma ação urgente; se quiser elevar a postura, mover para cookie `httpOnly` via um endpoint próprio de sessão (mudança grande) | — |
| I-12 | Front | Sem `headers()` de CSP/`X-Frame-Options` em `next.config.mjs`; sem `error.tsx`/`not-found.tsx`/`global-error.tsx` próprios (usa os genéricos do Next) | `apps/web/next.config.mjs` (só `transpilePackages`); `find apps/web/src -iname "error.tsx" -o -iname "not-found.tsx"` sem resultado | Baixo (o Next não vaza stack por padrão em produção); só falta identidade visual nas páginas de erro | Adicionar `headers()` básico e páginas de erro com a marca do Farol | P |
| I-13 | Front | Proteção de rota é só client-side (`useEffect` + `router.replace` em `apps/web/src/app/(app)/layout.tsx:38-40`); não há `middleware.ts` | Busca por `middleware.ts` na raiz de `apps/web`: nenhum | Baixo — nenhuma chamada à API acontece sem token (confirmado: toda função em `apps/web/src/lib/api.ts` lança 401 sem sessão), então nada sensível é exposto; só uma tela em branco pisca antes do redirecionamento | `middleware.ts` redirecionando antes do primeiro render, como defesa a mais | P |
| I-14 | Banco | Aplicação da migration `0007_regras_minimo.sql` no Supabase do projeto **não verificada**: não há como confirmar via API/REST se a função `validar_conteudo_regras` já tem a checagem de "conjunto vazio" no banco; o teste do smoke que passa (`gravar regras: conjunto vazio → 400`) é respondido pela validação em TypeScript da própria API (`packages/shared/src/regras-edicao.ts`), **antes** de chamar a função do banco — não prova que a 0007 foi aplicada | `apps/api/src/routes/regras.ts` — `PUT /regras` chama `validarRegras()` e devolve 400 sem nunca chamar `db.rpc("salvar_regras", ...)` quando há erro | Se a 0007 nunca foi aplicada, a trava redundante do banco não existe (a da API continua valendo) | Confirmar com uma consulta a `pg_proc`/`information_schema.routines` no painel do Supabase, ou reaplicar a 0007 (é idempotente) | P |
| I-15 | Observação | 13 vulnerabilidades adicionais do `npm audit` completo são só de `devDependencies` (`vitest`, `esbuild`, `tinypool`, `braces` — 2 críticas) | `npm audit` (rodado nesta revisão): total 15, das quais só 2 (postcss) tocam produção | Nenhum em produção (não são publicadas) | Atualizar quando for mexer no `vitest`/build tooling | P |

---

## 4. Matriz rota × perfil, e RLS/grants

### 4.1 Rotas da API

Legenda: ✅ permitido · 🚫 403 (negado + auditoria, salvo onde dito) · — não se aplica (rota exige um campo que o perfil não consegue satisfazer, ex. cidade fora do escopo)

| Rota | Administrador | Atendente | Despachante | Supervisor | Equipe de campo | Usuário Chave |
|---|---|---|---|---|---|---|
| `GET /health` | público (sem login) | | | | | |
| `GET /me` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `GET /cidades` | ✅ (todas) | ✅ (as suas) | ✅ (as suas) | ✅ (todas) | ✅ (as suas) | ✅ (as suas) |
| `GET /os/fila?cidade=` | ✅ | ✅ (só a sua) | ✅ (só a sua) | ✅ (inclusive `*`) | ✅ (só as da própria equipe) | ✅ (só a sua) |
| `GET /os/:id` | ✅ | ✅ (se da sua cidade) | ✅ (se da sua cidade) | ✅ | ✅ (só se da própria equipe, senão 403 "Esta OS não é da sua equipe") | ✅ (sem a aba de despacho) |
| `GET /os/criterios` | ✅ | ✅ | 🚫 (sem `nova`) | 🚫 | 🚫 | 🚫 |
| `GET /os/duplicidade` | ✅ | ✅ | 🚫 | 🚫 | 🚫 | 🚫 |
| `POST /os` | ✅ | ✅ | 🚫 | 🚫 | 🚫 | 🚫 |
| `POST /os/:id/solicitacoes` | ✅ | ✅ | 🚫 | 🚫 | 🚫 | 🚫 |
| `GET /os/:id/equipes` | ✅ | 🚫 | ✅ | ✅ | 🚫 | 🚫 |
| `POST /os/:id/status` | ✅ | — | ✅ (não "reabrir"/"cancelar", conforme a transição) | ✅ (inclusive reabrir) | 🚫 | 🚫 |
| `POST /os/:id/despacho` | ✅ | 🚫 | ✅ (exceção só se tiver `excecao`) | ✅ | 🚫 | 🚫 |
| `POST /os/:id/despacho/remover` | ✅ | 🚫 | ✅ | ✅ | 🚫 | 🚫 |
| `POST /os/:id/despacho/avancar` | ✅ | 🚫 | ✅ | ✅ | ✅ (só a própria equipe; sem equipe vinculada → 403) | 🚫 |
| `GET /mapa` | ✅ (inclusive `*`) | ✅ | ✅ | ✅ (inclusive `*`) | ✅ (só a própria equipe) | ✅ |
| `GET /pontuacao/versoes` | ✅ | 🚫 | 🚫 | ✅ (leitura, não edita) | 🚫 | ✅ |
| `PUT /pontuacao/rascunho` | ✅ | 🚫 | 🚫 | 🚫 | 🚫 | ✅ |
| `POST /pontuacao/validar` | ✅ | 🚫 | 🚫 | 🚫 | 🚫 | ✅ |
| `POST /pontuacao/publicar` | ✅ | 🚫 | 🚫 | 🚫 (403 "só aprova" — confirmado no `smoke.mjs`) | 🚫 | ✅ |
| `POST /pontuacao/aprovar` | ✅ (desde que não seja quem publicou) | 🚫 | 🚫 | ✅ (desde que não seja quem publicou) | 🚫 | ✅ (desde que não seja quem publicou) |
| `POST /pontuacao/restaurar` | ✅ | 🚫 | 🚫 | 🚫 | 🚫 | ✅ |
| `POST /pontuacao/descartar` | ✅ | 🚫 | 🚫 | 🚫 | 🚫 | ✅ |
| `GET /regras` | ✅ (editável) | ✅ (leitura) | ✅ (leitura) | ✅ (leitura) | 🚫 (bloqueio explícito, mesmo tendo `consultar`) | 🚫 (idem) |
| `POST /regras/prever` | ✅ | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |
| `PUT /regras` | ✅ | 🚫 | 🚫 | 🚫 | 🚫 | 🚫 |

**403 e auditoria:** todas as negações de escopo/permissão deste repositório chamam `auditar()` antes de responder 403 — confirmado em `apps/api/src/auth.ts` (`exigir()`) e repetido em cada rota que faz a checagem manualmente (`routes/os.ts`, `routes/despacho.ts`, `routes/mapa.ts`, `routes/pontuacao.ts`, `routes/regras.ts`). Única exceção notada: o **sucesso** de `GET /os/:id` nunca é auditado (P-02).

**IDOR:** toda rota que recebe um `:id` de OS carrega a linha primeiro e checa `veCidade()` antes de devolver qualquer dado (`routes/os.ts:33-39` em `despacho.ts`, `routes/os.ts` em si) — testei isso ao vivo: `atendente@farol.teste` (só BH) recebeu 403 em `GET /os/fila?cidade=CT` e `GET /mapa?cidade=CT` (smoke test, linhas "atendente fila CT → 403" e "mapa CT (atendente) → 403"). Não encontrei uma rota que aceite um id de OS sem essa checagem.

**Escalada de privilégio:** não encontrei um caminho em que um perfil menor consiga disparar uma ação de perfil maior — `pode()`/`exigir()` são checados em toda rota de escrita, e o banco repete a trava mais crítica (`salvar_regras` exige `perfil = 'Administrador'` de novo, direto no SQL — `supabase/migrations/0006_regras_edicao.sql`, confirmado no smoke: "gravar regras: não-Administrador → 403").

### 4.2 RLS e grants (testado ao vivo, nesta revisão)

| Tabela | RLS | `anon` | `authenticated` | Evidência |
|---|---|---|---|---|
| `ordens_servico` | ligado | 🚫 nega tudo (`42501`) | leitura **filtrada** por `pode_ver_cidade()`; escrita negada | consulta direta desta revisão: `anon` → `permission denied for table ordens_servico` (`code 42501`); `atendente@farol.teste` (autenticado, sem passar pela API) → leu 17 linhas, todas de BH; tentativa de `update` → `42501` |
| `regras_precedencia`, `regras_versoes`, `configuracoes`, `versoes_pontuacao`, `auditoria` | ligado, **sem policy nenhuma** (só `service_role` acessa) | 🚫 `42501` | 🚫 `42501` | mesma consulta: as 5 tabelas negaram para `anon`; `regras_precedencia` também negou para `atendente` autenticado |
| `cidades`, `resultados_prioridade`, `solicitacoes`, `despachos`, `equipes`, `eventos_os` | ligado | 🚫 `42501` | leitura filtrada por cidade (via `pode_ver_cidade()`/join com `ordens_servico`) | `anon` negado nas 6; `authenticated` não testado linha a linha nesta revisão, mas a política é a mesma função `pode_ver_cidade()` já confirmada para `ordens_servico` |
| `perfis` | ligado | 🚫 `42501` | só a própria linha (`user_id = auth.uid()`) | `atendente` autenticado: `select * from perfis` devolveu 1 linha (a própria) |

**Auth (painel a confirmar, o resto já testado ao vivo):**
- `disable_signup: false` — **cadastro público aberto** (P-05), confirmado via `GET /auth/v1/settings`.
- `mailer_autoconfirm: false` — confirmação de e-mail exigida (ok).
- Política de senha mínima, URLs de redirecionamento, SMTP próprio, expiração de sessão, MFA: **não verificado** (não exposto por `/auth/v1/settings` com a chave que tenho; confirmar no painel: Authentication → Settings/Policies).
- Backups: **não verificado** qual é o plano atual do projeto Supabase; se for o gratuito, não há backup automático (fato documentado da plataforma, não algo que eu tenha consultado neste projeto).
- Advisors de segurança/desempenho: **não verificado** — sem acesso ao MCP do Supabase nesta sessão.
- Região do projeto Supabase: **não verificado** (para comparar com `region: oregon` do Render em `render.yaml:6`).

---

## 5. Checklist de go-live

**No painel (você):**
- [ ] Desligar "Allow new users to sign up" no Supabase Auth (P-05).
- [ ] Confirmar política de senha, URLs de redirecionamento, SMTP próprio e expiração de sessão no painel do Supabase.
- [ ] Confirmar o plano do projeto Supabase e, se for o gratuito, decidir sobre backup (ex.: `pg_dump` agendado).
- [ ] Rodar os Advisors de segurança e desempenho do Supabase (preciso do MCP autorizado, ou faça você mesma pelo painel).
- [ ] Criar o serviço no Render a partir de `render.yaml` (plano `starter`, não `free` — o comentário do próprio arquivo já explica por quê) e preencher `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `CORS_ORIGIN` (com o domínio real da Vercel).
- [ ] Criar o projeto na Vercel com Root Directory `apps/web` e as 3 variáveis `NEXT_PUBLIC_*` (ver `apps/web/.env.example`), com `NEXT_PUBLIC_API_URL` apontando para a URL real do Render (nunca `localhost`).
- [ ] Rodar `docs/usuarios-de-teste.sql` **só** se for mesmo usar os perfis de demonstração; em produção real, cadastrar os usuários de verdade.

**No código (eu faço, com sua aprovação):**
- [ ] P-02, P-03: mascarar UC e auditar leitura de OS.
- [ ] P-04: `criar_os` transacional no Postgres.
- [ ] P-06: ao menos os testes de integração da API mais críticos, e um workflow de CI.
- [ ] I-06: mover `TRANSFORMADOR_RE`/`UC_RE` para `configuracoes`.
- [ ] I-10: `rel="noopener"` nos 2 links internos.

**Depois de subir (testar de verdade, não só ler código):**
- [ ] Criar uma OS pela Vercel e confirmar que ela aparece na fila e que o job de 60 s reclassifica.
- [ ] Conferir CORS: a Vercel consegue chamar a API, e nenhuma outra origem consegue (tentar `curl` de outra origem contra `/os/fila` com um `Origin` diferente).
- [ ] Rodar `scripts/smoke.mjs` apontando para as URLs reais (`API_URL`/`WEB_URL`) antes de anunciar a demonstração.
- [ ] Confirmar que `NEXT_PUBLIC_API_URL` não ficou `localhost` no build publicado (abrir o DevTools e checar a aba Network).

---

## 6. Plano de correção, em lotes de um commit cada

1. **LGPD da OS** (P-02, P-03) — `apps/api/src/routes/os.ts`, `apps/api/src/routes/mapa.ts` como referência. Critério de aceite: `GET /os/fila` e `GET /os/:id` não devolvem UC completa nem endereço para quem só tem `consultar`; `GET /os/:id` grava auditoria também no sucesso; smoke test cobrindo os dois.
2. **`criar_os` transacional** (P-04) — nova migration `0008`, função `criar_os`; `apps/api/src/services/os.ts` passa a chamar a função em vez de 3 inserts. Critério de aceite: forçar uma falha no meio (ex. UC inválida que só o banco rejeita) e confirmar que nenhuma linha parcial fica gravada; testes de `packages/shared` continuam passando.
3. **Formatos configuráveis** (I-06) — mover `TRANSFORMADOR_RE`/`UC_RE` para `configuracoes`, com teste cobrindo o valor vindo do banco. Critério de aceite: mudar o valor na tabela muda o comportamento da validação sem novo deploy.
4. **Rate limit e cabeçalhos** (I-07) — `@fastify/rate-limit` e `@fastify/helmet` em `apps/api/src/server.ts`. Critério de aceite: uma rajada de requisições de um único IP/usuário recebe 429 depois do limite; resposta tem `X-Content-Type-Options: nosniff`.
5. **Testes de integração da API** (P-06, parte 1) — um arquivo por rota crítica (`/os`, `/os/:id/despacho`, `/pontuacao`, `/regras`), batendo contra um Supabase de teste. Critério de aceite: cobre pelo menos os casos de 401/403/409 já verificados manualmente nesta revisão e no `smoke.mjs`.
6. **CI** (P-06, parte 2) — `.github/workflows/ci.yml` rodando `npm test && npm run typecheck && npm run build:api && npm run build:web` em todo PR. Critério de aceite: um PR com um teste quebrado falha o workflow.
7. **Links e detalhes do front** (I-10, I-12) — `rel="noopener"` e páginas de erro próprias. Critério de aceite: nenhum link interno sem `rel`; `/pagina-inexistente` mostra a identidade do Farol.

Os itens de §4, §6, §8, §11, §12 (I-01 a I-05) são maiores que um commit cada — cada um merece seu próprio plano, quando a operação confirmar as premissas do §14 do `REGRADENEGOCIO.md`.

---

## 7. Não verificado (e por quê)

- **Advisors de segurança e desempenho do Supabase** — sem acesso ao MCP do Supabase nesta sessão (exige autorização interativa).
- **Listagem oficial de políticas/grants via `pg_policies`/`information_schema`** — mesma razão; compensado por testes de leitura/escrita reais com `anon` e com um usuário `authenticated`, reportados na seção 4.2.
- **Se a migration `0007` foi de fato aplicada no Supabase do projeto** — a API tem uma validação equivalente em TypeScript que responde antes de chamar a função do banco, então o smoke test passando não prova que a trava do banco existe (I-14).
- **Política de senha, URLs de redirecionamento, SMTP e expiração de sessão do Auth** — não exposto pelo endpoint de configurações que consultei com a chave disponível.
- **Plano de cobrança do projeto Supabase (e portanto se há backup)** — não é algo que dê para ler pela API de dados.
- **Região do projeto Supabase**, para comparar com a região do Render — mesma limitação do MCP.
- **Concorrência real de `designar_equipe`** sob carga (duas chamadas simultâneas de verdade) — só a trava otimista do SQL foi lida, não exercida sob concorrência real nesta revisão.
- **Comportamento do job de 60 s quando o serviço Render "dorme"** — não há serviço publicado para observar isso na prática (decorre de P-01).

---

## 8. Perguntas ao dono do projeto

1. Este repositório já deve ser publicado agora (mesmo que só como demonstração), ou a revisão é só para planejamento? Isso muda a ordem dos próximos passos.
2. Os 2 serviços já existentes na sua conta do Render (`farol-api-rpv`, `farol-rpv`), de outro repositório — ainda são usados, ou posso sugerir removê-los quando formos organizar o deploy deste projeto?
3. Sobre o §4 (critérios) e o §6 (prazos): a operação já tem os critérios e os 5 prazos reais definidos, ou a v1 demonstrativa (8 critérios, 1 prazo) é o que vai para a primeira versão real também, por enquanto?
4. O cadastro público do Supabase Auth (P-05) foi deixado aberto de propósito (por exemplo, para algum fluxo futuro de autoatendimento), ou pode ser desligado já?
5. Qual é o plano do projeto Supabase hoje? Isso decide se backup é um bloqueador ou já está coberto.
6. Para a função `criar_os` transacional (P-04): tudo bem seguir o mesmo padrão já usado em `salvar_regras`/`designar_equipe` (função no Postgres com código de erro próprio), ou prefere outra abordagem?

---

## Verificação final (nada foi alterado)

```
npm test            → 10 suites, 167/167 testes
npm run typecheck   → sem erros
npm run build:api   → build ok (tsup)
npm run build:web   → build ok (Next.js, 9 rotas)
```

Caminho deste relatório: `docs/REVISAO-PRODUCAO.md`.
**Veredito resumido:** demonstração com dados fictícios — **PRONTO COM RESSALVAS**; produção real — **NÃO PRONTO**.
