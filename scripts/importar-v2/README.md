# Importação Farol v2

Execute os comandos a partir da raiz do repositório. O modo padrão lê os arquivos locais e gera relatório, sem gravar no banco:

```powershell
node scripts/importar-v2/importar.mjs
```

## Arquivo CSV de OS

Além da planilha oficial `OS manutenção pendente.xlsx`, o importador aceita o CSV UTF-8 separado por ponto e vírgula `OS manutenção pendente.csv`. Use o modelo versionado em `scripts/importar-v2/modelos/OS manutencao pendente.csv`, copie-o para a pasta informada em `--dados` e preencha somente as 12 colunas existentes no cabeçalho. A planilha `.xlsx`, quando presente, tem prioridade sobre o CSV.

O modelo não contém registros e não aceita campos pessoais. Não acrescente nome, endereço, medidor, conta, CDC ou ponto de entrega.

```powershell
Copy-Item '.\scripts\importar-v2\modelos\OS manutencao pendente.csv' '.\docs\dados\OS manutenção pendente.csv'
# Preencha o CSV e execute primeiro sem --gravar.
node scripts/importar-v2/importar.mjs
```

## Gravação no Supabase local (Docker)

`--gravar` altera dados e substitui as cargas de rede e OS importadas. O único destino aceito é o PostgreSQL do Supabase local em `127.0.0.1` ou `localhost`, porta `54322`. Hosts remotos — inclusive `*.supabase.co` — e qualquer outra porta são bloqueados antes de ler arquivos ou abrir conexão.

Copie `.env.docker.example` para `.env.docker`, preencha somente os valores locais e mantenha o arquivo fora do Git. O importador deriva a API REST local da URL PostgreSQL validada; não aceita URL de API configurável.

```powershell
node --env-file=.env.docker scripts/importar-v2/importar.mjs --gravar
```

O mesmo bloqueio vale para `--atualizar-regional --gravar`. Não use `--linked` nem configure URL de projeto remoto.

### Atalho para testar e importar localmente

No PowerShell, o arquivo abaixo executa primeiro os testes do importador e a simulação sem escrita. A gravação só ocorre com `-Gravar`, depois de confirmar que `.env.docker` aponta para `127.0.0.1` ou `localhost` na porta `54322`:

```powershell
.\scripts\importar-v2\importar-e-testar-local.ps1
.\scripts\importar-v2\importar-e-testar-local.ps1 -Gravar
```

Este repositório usa nomes sequenciais `0001_...sql` até `0016_os_numeros_existentes.sql`. A CLI gera por padrão nomes com prefixo de data; não misture formas de aplicação ou faça sincronização automática sem reconciliar os números no histórico remoto. Aplique na ordem 0001, `supabase/seed.sql`, 0002–0016. PostGIS deve ser criado em `extensions`; a 0008 falha se já estiver em outro schema. Não remova uma extensão existente com dependências sem avaliar a perda de dados.

Depois de aplicar as migrações num banco de teste, rode os testes abaixo com uma conexão privilegiada desse banco. Os três revertem seus dados de teste:

```powershell
psql $env:DATABASE_URL_TESTE -v ON_ERROR_STOP=1 -f supabase/tests/rede_raio.sql
psql $env:DATABASE_URL_TESTE -v ON_ERROR_STOP=1 -f supabase/tests/rede_permissao_campo.sql
psql $env:DATABASE_URL_TESTE -v ON_ERROR_STOP=1 -f supabase/tests/rede_permissoes.sql
```

API de rede (`apps/api/src/routes/rede.ts`): o cliente usa `service_role` e ignora RLS, por isso a regra de perfil (`rede.perfis_com_acesso`, `rede.perfis_sugerir_carona`) é aplicada na própria API. Testes: `npm test` (unitários) e `npm run test:integracao` (login real no Supabase local, exige o stack completo e `SUPABASE_ANON_KEY` no `.env.docker`).

O stack completo (com auth) agora sobe no Docker local e o teste com login real o usa; ele consome mais memória que o stack mínimo (`db`, `rest`, `kong`). Aplique também as migrações 0011 a 0016.

## Módulo da rede: regras vigentes, medições e pendências

**Regra de perfil.** Só o Administrador acessa a rede e sugere carona (`rede.perfis_com_acesso` e `rede.perfis_sugerir_carona`, migração 0014). Equipe de campo, Supervisor, Despachante, Atendente e Usuário Chave recebem 403. A sugestão é simétrica: A→B e B→A são o mesmo par.

**Rotas** (`apps/api/src/routes/rede.ts`): `GET /rede/config` (inclui `pode_sugerir`), `/rede/circuitos`, `/rede/circuitos/:codigo` (+ `/tracado`, `/chaves`, `/transformadores`), `/rede/os` (filtros `?circuito=` e `?regional=`), `/rede/regionais`, `/rede/os/:numero/proximas`, `POST /rede/sugestoes`.

**Medição de `GET /rede/os`** (banco local, 4.513 OS, sem `@fastify/compress`, via `app.inject` com login real): 208 a 293 ms por chamada (6 chamadas em 2 execuções) e 1.335.519 bytes (1.304 kB). A leitura é paginada de 1.000 em 1.000 porque o PostgREST limita cada resposta (`api.max_rows = 1000`). Compressão e cache ficam para o plano de ambiente real.

**Sobre `sugestoes_carona`.** A tabela da migração 0008 liga `ordens_servico` por uuid e não é usada pela rede. A rede usa `sugestoes_rede` (0012; unicidade do par não ordenado na 0014).

**Pendências**
- (a) Otimizar a política de RLS: direto no PostgREST, negar acesso a quem não pode varre as tabelas grandes (cerca de 20 s por perfil nas tabelas de chaves, transformadores e traçado) porque a função de perfil é avaliada por linha. Não afeta a API (`service_role`).
- (b) Circuitos com grafia diferente entre as bases: a base de chaves usa `CET-LUM2/3/4` e as bases de clientes e de OS usam `CET-LUM 2/3/4`; há também `CQT1-CQT` e `ERA-ERA2`. São 40 OS com circuito não identificado. Não há correção automática; a operação decide. Um deles (`CQT1-CQT`, 1 OS) nem existe na tabela `circuitos`, então aparece em `/rede/os` mas não em `/rede/circuitos`.
- (c) A ordem das OS do circuito é informativa e não usa data de abertura, que a base importada não traz.
- (d) Filtro por cidade fora desta fase: as OS importadas têm `municipio` (texto), sem ligação com `cidades.id`.
- (e) Resolvida: o `CLAUDE.md` e o `AGENTS.md` agora dizem que o `apps/web` usa Tailwind com tokens do `globals.css`, sem shadcn/ui.
- (a) Migração `0017_rls_rede_initplan.sql` (ainda não aplicada em nenhum banco): as políticas de leitura da rede usam `(select perfil_ve_rede())`, avaliado uma vez por consulta. Valide no banco local rodando os três testes de `supabase/tests/rede_*.sql` e medindo o acesso direto ao PostgREST antes de aplicar em outro ambiente.

## Cadastro de OS por arquivo (formato "OS manutenção pendente")

Regras completas em `docs/REGRADENEGOCIO.md`, seção 15.9. Passo a passo de conferência: `docs/ROTEIRO-MAPA-REDE.md`, seção 10. Migrações `0015` (colunas, configuração e a função `importar_os_pendentes`) e `0016` (apoio da prévia). Rotas: `POST /os/importar-pendentes/preview` e `/confirmar` (só o Administrador). Testes: `supabase/tests/importar_os_pendentes.sql`, `npm test` (shared, API e web) e `npm run test:integracao` (arquivo real em prévia; gravação com linhas sintéticas que ficam canceladas).

Medições no banco local (4.513 OS): prévia do arquivo real ~1 s; lote de 200 OS ~1,6 s; importação completa ~36 s em 23 lotes.

**Pendências**
- (a) Formulário individual no mesmo formato (Fase B). Hoje só a importação em lote aceita o formato da planilha.
- (b) Só CSV no navegador. XLSX exigiria uma biblioteca no front (o shared já aceita `Date` e serial do Excel).
- (c) Todas as OS importadas entram como Urgente (58 pontos: critérios de risco sem resposta valem "Desconhecido"). O critério `prazo` da versão demonstrativa não tem opção "Desconhecido"; se quiser que prazo desconhecido pontue, a opção precisa existir na versão publicada.
- (d) As OS ficam duplicadas entre `ordens_servico` (fila do Farol) e `os_importadas` (base do Mapa da rede). O Mapa da rede continua lendo só a segunda.
- (e) O `autenticar` da API devolve 401 para qualquer falha do auth, inclusive timeout (504): sob carga o front desloga o usuário. Distinguir 5xx de token inválido.
- (f) Quem cria solicitações não pode ser apagado (`solicitacoes.criado_por` é imutável); os testes de integração usam usuários fixos de teste e os bloqueiam ao final.
