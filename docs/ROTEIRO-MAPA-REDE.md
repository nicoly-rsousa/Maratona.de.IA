# Roteiro manual: Mapa da rede (fase 2, visão geral)

Confira a tela `/rede` contra o banco **local**. Dura uns 15 minutos. Nada aqui usa Supabase remoto.
Os números abaixo valem para a carga atual (4.513 OS). Se você reimportar outros dados, eles mudam.

## 1. Pré-requisitos

1. Docker Desktop em execução e o stack **completo** do Supabase local no ar (precisa do auth):
   ```powershell
   npx supabase start
   npx supabase status -o env      # mostra API_URL, ANON_KEY e SERVICE_ROLE_KEY locais
   ```
2. Banco com as migrações até a `0014` e a carga importada. Conferência rápida:
   ```powershell
   docker exec supabase_db_farol psql -U postgres -At -c "select (select count(*) from os_importadas), (select count(*) from circuitos), (select valor from configuracoes where chave='rede.perfis_com_acesso')"
   ```
   Esperado: `4513 | 277 | ["Administrador"]`. Se faltar carga: `node --env-file=.env.docker scripts/importar-v2/importar.mjs --gravar`.

## 2. Usuários de teste (um Administrador e uma Equipe de campo)

1. Abra o Studio local em <http://127.0.0.1:54323> → **Authentication → Users → Add user → Create new user**, marcando "Auto Confirm User":
   `admin@farol.teste` e `campo@farol.teste`, com uma senha de teste que só você sabe (não grave senha em arquivo nem em chat).
2. Crie os perfis:
   ```powershell
   docker exec -i supabase_db_farol psql -U postgres -c "insert into perfis (user_id, nome, perfil, todas_cidades) select id, 'Admin teste', 'Administrador', true from auth.users where email='admin@farol.teste' on conflict (user_id) do update set perfil='Administrador', todas_cidades=true; insert into perfis (user_id, nome, perfil, todas_cidades) select id, 'Campo teste', 'Equipe de campo', false from auth.users where email='campo@farol.teste' on conflict (user_id) do update set perfil='Equipe de campo', todas_cidades=false;"
   ```
   Deve responder `INSERT 0 1` duas vezes.

## 3. Variáveis de ambiente (arquivos ignorados pelo Git)

`apps/api/.env`:
```
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SERVICE_ROLE_KEY=<SERVICE_ROLE_KEY do status -o env>
CORS_ORIGIN=http://localhost:3000
PORT=3001
```
`apps/web/.env.local` (no navegador só vai a chave **anon**; nunca a service_role):
```
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<ANON_KEY do status -o env>
```

## 4. Subir API e web (dois terminais, na raiz do repositório)

```powershell
npm run dev:api     # espere "Server listening"; teste: http://localhost:3001/health  → {"ok":true,...}
npm run dev:web     # http://localhost:3000
```

## 5. Como Administrador (`admin@farol.teste`)

| # | O que fazer | O que deve aparecer |
|---|---|---|
| 1 | Entre em <http://localhost:3000/login>. | Vai para a fila. O menu lateral tem **Mapa da rede**. |
| 2 | Clique em **Mapa da rede**. | Rapidamente "Verificando seu acesso…" e "Carregando as OS…"; depois o mapa. |
| 3 | Leia o cabeçalho. | **4.513 OS** · "dados importados em dd/mm/aaaa às hh:mm" · "carregado neste navegador às hh:mm (guardado por 5 min)". Texto dizendo que é informativa e **não é a fila de prioridade do Farol**. |
| 4 | Olhe o mapa. | O mapa enquadra a região das OS (Minas/RJ) com **4.513 pontos** coloridos. Fundo OpenStreetMap com atribuição no canto. Nenhum traçado, chave ou transformador (isso é a fase 3). |
| 5 | Leia a legenda (título "Prioridade legada (informativa, não é a fila do Farol)"). | Emergente **130**, Urgente **1.167**, Alta **1.463**, Média **1.077**, Baixa **676**, Sem mapa **0** (soma 4.513). Linha "Anel vazado: circuito não identificado" com **40 OS**. |
| 6 | Dê zoom perto de uma das OS sem circuito (veja o item 8). | **40 anéis vazados** (círculo sem preenchimento, borda grossa) entre os pontos cheios. |
| 7 | Passe o mouse num ponto. | Tooltip: `número · Classe (legada: X)`; nos anéis acrescenta "· circuito não identificado". |
| 8 | Role até **OS sem circuito identificado (40)**. | Aviso: "Circuito não identificado… Não é corrigido automaticamente; a operação revisa." Tabela com 40 linhas (OS, circuito informado, município, prioridade legada). Uma delas tem o circuito `CQT1-CQT`. |
| 9 | Clique em **Ver no mapa** numa linha. | O mapa centraliza e aproxima a OS; o ponto fica **maior com contorno forte**; o painel "Detalhe" mostra a OS e repete o aviso de circuito não identificado. |
| 10 | Clique num ponto cheio. | O detalhe mostra "Classe (informativa)", prioridade legada, circuito, município, prazo; **sem** aviso. |
| 11 | Clique em **Recarregar dados**. | O botão vira "Atualizando…" e desabilitado; depois volta e a hora de "carregado" muda. |
| 12 | Saia da tela e volte em menos de 5 min (DevTools → Network). | Não há nova chamada a `/rede/os` (cache de 5 min só no front). Depois de 5 min, entrar de novo faz a chamada. |
| 13 | Alterne **Tema** (claro/escuro). | As cores dos pontos e a legenda acompanham o tema. |
| 14 | Troque a **Cidade** no cabeçalho. | Continua em `/rede` (não redireciona para `/fila`). |
| 15 | Use só o teclado (Tab). | Chega a "Recarregar dados", "Pular o mapa" (aparece ao focar) e aos botões "Ver no mapa". Com o mapa focado, setas movem e `+`/`-` dão zoom. |
| 16 | Arraste e dê zoom com todos os pontos. | Fluido (os pontos são desenhados em canvas, não como 4.513 elementos). |

## 6. Como Equipe de campo (`campo@farol.teste`)

| # | O que fazer | O que deve aparecer |
|---|---|---|
| 1 | Clique em **Sair** e entre com `campo@farol.teste`. | O menu também mostra **Mapa da rede** (o servidor é quem decide o acesso). |
| 2 | Clique em **Mapa da rede**. | Caixa vermelha: **"Sem acesso. Seu perfil não tem acesso ao Mapa da rede. O acesso é definido pela administração; a tentativa foi registrada."** Sem mapa, sem legenda, sem botão "Tentar novamente". |
| 3 | DevTools → Network. | Só uma chamada a `/rede/config` com **403**. Nenhuma a `/rede/os`. |
| 4 | Confira a auditoria (opcional): `docker exec supabase_db_farol psql -U postgres -c "select acao, resultado, em from auditoria where acao like 'negado:rede%' order by id desc limit 3"` | Linha `negado:rede` com resultado `negado`. |

## 7. Sessão inválida e sem login

- **Sem login:** abra <http://localhost:3000/rede> deslogado → vai para `/login`.
- **Sessão inválida:** logado como Administrador, no DevTools → Application → Local Storage, edite o valor da chave que começa com `sb-` e termina em `-auth-token` (estrague o `access_token`), recarregue `/rede` → "Sua sessão expirou. Redirecionando para o login…" e volta ao `/login`.

## 8. Se algo não bater

| Sintoma | Provável causa |
|---|---|
| Erro de CORS no console | `CORS_ORIGIN` da API diferente da URL do web (`http://localhost:3000`). |
| "Sessão expirada" logo após entrar | `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` do web não são do stack local, ou a API aponta para outro projeto. |
| 403 para o Administrador | `rede.perfis_com_acesso` sem `"Administrador"` (veja o passo 2 dos pré-requisitos) ou o perfil não foi criado. |
| Mapa vazio, sem OS | Importação não rodada (passo 2 dos pré-requisitos). |
| Contagens diferentes das da legenda | A carga é outra. A soma das classes mais "sem mapa" deve igualar o total do cabeçalho. |

Ao terminar, pare os dois servidores com `Ctrl+C`. Para parar o Supabase local: `npx supabase stop`.
