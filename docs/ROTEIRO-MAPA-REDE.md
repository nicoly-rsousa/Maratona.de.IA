# Roteiro manual: Mapa da rede (fases 2 e 3: visão geral e alimentador selecionado)

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
| 4 | Olhe o mapa. | O mapa enquadra a região das OS (Minas/RJ) com **4.513 pontos** coloridos. Fundo OpenStreetMap com atribuição no canto. Sem alimentador selecionado: nenhum traçado, chave ou transformador (eles só aparecem ao escolher um alimentador; veja a seção 6). |
| 5 | Leia a legenda (título "Prioridade legada (informativa, não é a fila do Farol)"). | Emergente **130**, Urgente **1.167**, Alta **1.463**, Média **1.077**, Baixa **676**, Sem mapa **0** (soma 4.513). Linha "Anel vazado: alimentador não identificado" com **40 OS**. |
| 6 | Dê zoom perto de uma das OS sem alimentador (veja o item 8). | **40 anéis vazados** (círculo sem preenchimento, borda grossa) entre os pontos cheios. |
| 7 | Passe o mouse num ponto. | Tooltip: `número · Classe (legada: X)`; nos anéis acrescenta "· alimentador não identificado". |
| 8 | Role até **OS sem alimentador identificado (40)**. | Aviso: "Alimentador não identificado… Não é corrigido automaticamente; a operação revisa." Tabela com 40 linhas (OS, alimentador informado, município, prioridade legada). Uma delas tem o alimentador `CQT1-CQT`. |
| 9 | Clique em **Ver no mapa** numa linha. | O mapa centraliza e aproxima a OS; o ponto fica **maior com contorno forte**; o painel "Detalhe" mostra a OS e repete o aviso de alimentador não identificado. |
| 10 | Clique num ponto cheio. | O detalhe mostra "Classe (informativa)", prioridade legada, alimentador, município, prazo; **sem** aviso. |
| 11 | Clique em **Recarregar dados**. | O botão vira "Atualizando…" e desabilitado; depois volta e a hora de "carregado" muda. |
| 12 | Saia da tela e volte em menos de 5 min (DevTools → Network). | Não há nova chamada a `/rede/os` (cache de 5 min só no front). Depois de 5 min, entrar de novo faz a chamada. |
| 13 | Alterne **Tema** (claro/escuro). | As cores dos pontos e a legenda acompanham o tema. |
| 14 | Troque a **Cidade** no cabeçalho. | Continua em `/rede` (não redireciona para `/fila`). |
| 15 | Use só o teclado (Tab). | Chega a "Recarregar dados", "Pular o mapa" (aparece ao focar) e aos botões "Ver no mapa". Com o mapa focado, setas movem e `+`/`-` dão zoom. |
| 16 | Arraste e dê zoom com todos os pontos. | Fluido (os pontos são desenhados em canvas, não como 4.513 elementos). |

## 6. Fase 3: selecionar um alimentador (como Administrador)

Na coluna da direita, o quadro **Alimentador** tem uma busca. Ela ignora espaço, hífen e maiúsculas: `cetlum2` acha **CET-LUM 2** e **CET-LUM2**. Depois de escolher um alimentador, **só os dados dele** são carregados e desenhados.

**Dica de verificação (DevTools → Network):** sem alimentador selecionado só aparecem `/rede/config`, `/rede/os` e `/rede/circuitos`. Ao escolher um alimentador entram as chamadas dele (`/rede/circuitos/<código>`, `/tracado`, `/chaves`, `/transformadores`), e só as que ele tem.

### 6.1 LPD-1 (traçado real, baixa tensão)

| # | O que fazer | O que deve aparecer |
|---|---|---|
| 1 | Busque `LPD-1` e clique no resultado. | O mapa enquadra o alimentador. As **117 OS do LPD-1 ficam em destaque** (maiores, com contorno) e as demais **esmaecidas** (continuam visíveis). |
| 2 | Veja o traçado. | Linhas coloridas **pelo trecho**: trecho 1 **vermelho** (`#e31a1c`), trecho 2 **azul** (`#121dd9`), trecho 3 **verde** (`#069e17`). Só média tensão. |
| 3 | Veja a **Legenda do alimentador**. | Trecho 1 (**56** segmentos), Trecho 2 (**353**), Trecho 3 (**603**). Chaves por **nome do tipo**: Chave Fusível **292**, Chave Faca **137**, Chave Fusível Religadora **5**, Chave Lâmina **3**, Chave Seccionadora **2** (total **439**). |
| 4 | Confira que **"Mostrar baixa tensão (LV)"** começa **desmarcada** (texto "Desligada por padrão"). Network: `/tracado` **sem** `?bt=1`. | Nenhuma linha laranja no mapa. |
| 5 | Marque a caixa. | Network: `/tracado?bt=1`. Aparecem **1.159** segmentos LV **laranja** (trecho 4) e **8** segmentos LV de **trecho 3 em VERDE**, a mesma cor do trecho 3 da média tensão (a cor é pelo trecho, não pela rede). Legenda: Trecho 3 = 611 segmentos "(8 de baixa tensão)"; Trecho 4 = 1.159 "(1.159 de baixa tensão)". |
| 6 | Desmarque e marque de novo. | Some e volta a LV. A segunda vez **não** faz nova chamada (cache). |
| 7 | Leia o **painel do alimentador**. | Clientes: total **5.683**, ligados **4.715**, desligados **968**. Traçado: "Sim (real, por trecho)". OS do alimentador: **117**, com o aviso de **ordem informativa** (não é a fila do Farol). |
| 8 | Veja os transformadores. | Painel: "230 transformadores · 5.683 clientes identificados", "104 no mapa … · 126 transformadores sem posição" e o texto de apoio: "cerca de 24% dos clientes da base não têm alimentador, então os totais podem estar subestimados". No mapa: **104 círculos** com o nº de clientes dentro (rotulados como **clientes identificados** na legenda). Nenhum ponto por cliente ou medidor. |
| 9 | Passe o mouse numa linha, numa chave e num círculo. | Tooltips: "Média tensão · trecho 2 · id", "Chave Fusível · nº operativo", "Transformador X · N clientes identificados (M ligados)". |
| 10 | Clique em **Limpar seleção**. | Volta à visão geral: todas as OS normais, sem destaque, sem linhas. |

### 6.2 LPD-5 (outro alimentador com traçado)

| # | O que fazer | O que deve aparecer |
|---|---|---|
| 1 | Busque `LPD-5` e clique. | Traçado por trecho: trecho 1 **187**, trecho 2 **385**, trecho 3 **1.623** segmentos (MV). A caixa de baixa tensão volta **desmarcada** (ao trocar de alimentador ela sempre desliga). |
| 2 | Marque a baixa tensão. | LV: **558** segmentos de trecho 4 (laranja) e **5** de trecho 3 (verde). |
| 3 | Painel. | Clientes: **2.537** (ligados **1.997**, desligados **540**); chaves **730**; **106** OS; "631 transformadores", **106** no mapa e **525 sem posição**. |

### 6.3 Alimentador sem traçado, com chaves: REA-DOC (contorno aproximado)

| # | O que fazer | O que deve aparecer |
|---|---|---|
| 1 | Busque `REA-DOC` e clique. | **Não há linhas** de traçado e **não há caixa de baixa tensão**. Network: **nenhuma** chamada a `/tracado`. |
| 2 | Veja o contorno. | Polígono **tracejado** em volta das **1.114 chaves**, rotulado **"Contorno aproximado (envoltória das chaves)"** na legenda e na nota do painel ("Não é o traçado real"). Painel: "Traçado: Não (aproximado)". |
| 3 | Painel e legenda. | Clientes **7.534** (ligados **5.916**, desligados **1.618**); **40** OS; chaves por tipo: Chave Fusível **980**, Chave Faca **108**, Chave Fusível Religadora **24**, Chave Lâmina **2**; "1.016 transformadores", **364** no mapa e **652 sem posição**. |

### 6.4 CET-LUM 2 (código com espaço, sem traçado e sem chaves)

| # | O que fazer | O que deve aparecer |
|---|---|---|
| 1 | Busque `cet lum 2`. | Aparece **CET-LUM 2** (com espaço); `cetlum2` mostra também **CET-LUM2** (grafia da base de chaves). **Não** são unidos nem corrigidos. |
| 2 | Clique em **CET-LUM 2**. | Network: `/rede/circuitos/CET-LUM%202` e `/transformadores`; **nenhuma** chamada a `/chaves` nem a `/tracado`. |
| 3 | Painel. | "Chaves: **sem chaves na base**"; "Sem traçado e sem chaves na base: aparecem só as OS e os transformadores com posição". Clientes **4.106** (ligados **3.777**, desligados **329**); **7** OS. **Sem contorno** (não há chaves). |
| 4 | Transformadores. | "282 transformadores · 4.106 clientes identificados"; **180** círculos no mapa; **102 sem posição**. O mapa enquadra onde estão esses transformadores. |
| 5 | Clique numa das 7 OS dele no mapa. | O detalhe mostra o aviso de **alimentador não identificado** e o botão **"Abrir o alimentador informado (CET-LUM 2)"**. O alimentador **não abre sozinho**; abre só ao clicar no botão. |

### 6.5 Alimentadores com menos de 3 chaves (só pontos)

| # | O que fazer | O que deve aparecer |
|---|---|---|
| 1 | Busque `CT2R1-MRI` (1 chave) e clique. | Um único ponto de chave, **sem polígono**. Nota: "Menos de 3 chaves distintas (ou todas alinhadas): só os pontos, sem contorno." Clientes: **desconhecido** (3 vezes; nunca 0). 0 OS, 0 transformadores. |
| 2 | Busque `SMA-PAO` (2 chaves) e clique. | Dois pontos, sem polígono, mesma nota. |
| 3 | Para comparar, volte ao REA-DOC. | Aí sim o polígono aparece (3 ou mais chaves não alinhadas). |

### 6.6 Clicar numa OS no mapa

| # | O que fazer | O que deve aparecer |
|---|---|---|
| 1 | Limpe a seleção e clique num ponto cheio de uma OS do LPD-1. | O alimentador **LPD-1** abre sozinho (a OS tem alimentador identificado). |
| 2 | Clique num **anel vazado** (OS sem alimentador identificado), por exemplo uma de `CQT1-CQT`. | Detalhe com o aviso; **nenhum alimentador** abre e não há botão (esse código nem existe na lista de alimentadores). |

## 7. Como Equipe de campo (`campo@farol.teste`)

| # | O que fazer | O que deve aparecer |
|---|---|---|
| 1 | Clique em **Sair** e entre com `campo@farol.teste`. | O menu também mostra **Mapa da rede** (o servidor é quem decide o acesso). |
| 2 | Clique em **Mapa da rede**. | Caixa vermelha: **"Sem acesso. Seu perfil não tem acesso ao Mapa da rede. O acesso é definido pela administração; a tentativa foi registrada."** Sem mapa, sem legenda, sem botão "Tentar novamente". |
| 3 | DevTools → Network. | Só uma chamada a `/rede/config` com **403**. Nenhuma a `/rede/os`. |
| 4 | Confira a auditoria (opcional): `docker exec supabase_db_farol psql -U postgres -c "select acao, resultado, em from auditoria where acao like 'negado:rede%' order by id desc limit 3"` | Linha `negado:rede` com resultado `negado`. |

## 8. Sessão inválida e sem login

- **Sem login:** abra <http://localhost:3000/rede> deslogado → vai para `/login`.
- **Sessão inválida:** logado como Administrador, no DevTools → Application → Local Storage, edite o valor da chave que começa com `sb-` e termina em `-auth-token` (estrague o `access_token`), recarregue `/rede` → "Sua sessão expirou. Redirecionando para o login…" e volta ao `/login`.

## 9. Se algo não bater

| Sintoma | Provável causa |
|---|---|
| Erro de CORS no console | `CORS_ORIGIN` da API diferente da URL do web (`http://localhost:3000`). |
| "Sessão expirada" logo após entrar | `NEXT_PUBLIC_SUPABASE_URL`/`ANON_KEY` do web não são do stack local, ou a API aponta para outro projeto. |
| 403 para o Administrador | `rede.perfis_com_acesso` sem `"Administrador"` (veja o passo 2 dos pré-requisitos) ou o perfil não foi criado. |
| Mapa vazio, sem OS | Importação não rodada (passo 2 dos pré-requisitos). |
| Alimentador sem linhas nem círculos | Pode ser o esperado (veja 6.3 a 6.5): sem traçado só há contorno aproximado; sem chaves e sem transformadores com posição só ficam as OS. |
| Contagens diferentes das da legenda | A carga é outra. A soma das classes mais "sem mapa" deve igualar o total do cabeçalho. |

Ao terminar, pare os dois servidores com `Ctrl+C`. Para parar o Supabase local: `npx supabase stop`.

## 10. Cadastro de OS por arquivo CSV (Nova solicitação → Importar)

Só o **Administrador** faz esse cadastro (ele cria uma cidade por município). Não use o banco de produção: tudo aqui é no banco local.

**Arquivos para testar**
- **Amostra pequena (11 linhas, sem dado real):** `docs/exemplos/importacao-os-pendentes-amostra.csv`. Tem todos os casos de borda.
- **Arquivo completo (4.513 linhas, 95 colunas):** `docs/dados/OS manutenção pendente.csv`, gerado do XLSX real. Fica fora do Git. Se não existir na sua máquina, exporte o XLSX como CSV (UTF-8 ou Windows-1252, separador `;`).

**Pré-requisito:** a versão de pontuação demonstrativa publicada. No banco local: `npm run seed -w @farol/api` (se já existir, responde "Versão v1 já existe").

### 10.1 Amostra pequena

| # | O que fazer | O que deve aparecer |
|---|---|---|
| 1 | Entre como `admin@farol.teste`. Em **Nova solicitação**, role até o final e clique em **Importar de um arquivo CSV**. | Página com o quadro **Modelo do arquivo**: **OS manutenção pendente (padrão)** já marcado. |
| 2 | Escolha `importacao-os-pendentes-amostra.csv`. | "Selecionado: … · **11 linhas de dados**". E: "só as 15 colunas usadas são enviadas ao servidor. As outras **2 colunas** do arquivo não saem do seu computador" (INSPETOR e Observação). |
| 3 | Clique em **Pré-visualizar**. | **Linhas lidas 11 · Entram 8 · Rejeitadas 3 · Entram com aviso 4 · Sem coordenada 6 · Já existentes 0**. Cidades: **3 municípios, 3 serão criadas** (MUNICIPIO AMOSTRA A, MUNICIPIO AMOSTRA B e DISTRITO X / MUNICIPIO AMOSTRA B). Endereço: informado 1, derivado do poste 1, não informado 6. |
| 4 | Veja **Rejeitadas**. | Linha 5 "sem número da OS", linha 6 "sem município…", linha 12 "número da OS repetido no arquivo (primeira ocorrência na linha 2)". |
| 5 | Veja **Avisos**. | UTM com só X (1), quantidade de clientes inválida (1), prazo ilegível (1) e Complemento fora do formato de poste (1). Nenhum aviso repete o texto livre do Complemento. |
| 6 | Clique em **Baixar arquivo de rejeitadas (.csv)** e abra. | Só `linha;motivo` e as colunas permitidas (OSNumero, CodSetor, CodPrioridade, DataDeadline, Quantidade clientes, Localidade, DescEsquema, Familias, UTM X/Y, lat/lng). **Sem** Logradouro, Bairro nem Complemento. |
| 7 | Clique em **Importar 8 OS em lotes de 200**. | Barra de progresso (1 lote). Resumo: **8 OS criadas, 0 já existentes, 3 cidade(s) criada(s)**. |
| 8 | Repita o passo 2 em diante com o mesmo arquivo. | Prévia: **Já existentes 8**. Importar: **0 OS criadas, 8 já existentes (não duplicadas)**, 0 cidades criadas. |
| 9 | No cabeçalho, no seletor **Cidade**, escolha **MUNICIPIO AMOSTRA A**. Abra a **Fila**. | A fila mostra as OS importadas desse município. Abra uma: o endereço aparece como `Poste 48-160 — MUNICIPIO AMOSTRA A` ou `Endereço não informado — …`. |

### 10.2 Arquivo completo (4.513 OS)

| # | O que fazer | O que deve aparecer |
|---|---|---|
| 1 | Na mesma tela, escolha `docs/dados/OS manutenção pendente.csv`. | **4.513 linhas de dados**; as outras **80 colunas** não saem do computador. |
| 2 | **Pré-visualizar** (leva cerca de 1 s). | **Entram 4.513 · Rejeitadas 0 · com aviso 0 · Sem coordenada 0**. Cidades: **92 municípios, 92 serão criadas**. Endereço: **derivado do poste 4.513**. **Campos vazios por coluna:** só **Logradouro 4.513 (100%)** e **Bairro 4.513 (100%)**. Nenhum prazo vazio. |
| 3 | Leia o aviso sobre prioridade. | Texto explicando que os critérios de risco sem resposta valem "Desconhecido" (pontua, nunca zero) e que prioridade legada, prazo e clientes ficam só como informação. |
| 4 | **Importar 4.513 OS em lotes de 200**. | 23 lotes (22 de 200 e 1 de 113), cerca de **40 s** no banco local. Resumo: **4.513 criadas, 0 já existentes, 92 cidades criadas** e "Prioridade **Urgente**: 4.513 OS" (veja a observação abaixo). |
| 5 | Importe de novo o mesmo arquivo. | Prévia: **Já existentes 4.513**. Importar: **0 criadas, 4.513 já existentes**. Nada duplica. |
| 6 | Abra o **Mapa** (menu) e a cidade **MURIA** (MURIAE). | Pontos das OS dessa cidade (as coordenadas UTM foram convertidas). |

**Observação sobre a prioridade (leia antes de importar o arquivo completo):** a planilha não traz as respostas dos critérios de risco do Farol. Na versão demonstrativa, cada critério sem resposta vale "Desconhecido" (vida 15, serviço essencial 10, fonte de reserva 10, pessoas afetadas 8, estrutura 10), mais 5 da manutenção corretiva: **58 pontos**, que caem na faixa **Urgente**. Ou seja, **as 4.513 OS entram como Urgente** na fila do Farol, e isso é o resultado correto da regra "desconhecido não é risco zero". Se você não quer isso na fila, não importe o arquivo completo no banco que vai ser demonstrado.

### 10.3 Casos de erro

| # | O que fazer | O que deve aparecer |
|---|---|---|
| 1 | Escolha um CSV sem a coluna `OSNumero` ou sem `Localidade`. | Erro vermelho citando a coluna que falta; o botão Pré-visualizar fica desabilitado. |
| 2 | Escolha um arquivo vazio. | "O arquivo não tem linhas de dados." |
| 3 | Entre com um perfil que não seja Administrador e tenha a permissão de cadastrar (ex.: um Atendente) e abra a mesma tela. | O modelo **OS manutenção pendente** vem desabilitado com o aviso "Disponível só para o Administrador"; o modelo simples continua disponível. Sem `todas as cidades`, a API também responde 403. |
| 4 | Durante a importação do arquivo completo, clique em **Cancelar**. | Para depois do lote atual: "Importação interrompida depois do lote N de 23" e o botão **Continuar**, que retoma do lote seguinte sem repetir os anteriores. |
