# Farol — roteiro de teste da pontuação (Etapa E)

Objetivo: provar, no banco real, os pontos que testes unitários não alcançam:

1. **Concorrência do rascunho**: duas pessoas salvando o mesmo rascunho com o mesmo `etag` resultam em **uma** gravação e **um 409**; nunca há dois rascunhos no mesmo escopo.
2. **Autor não aprova** a própria versão.
3. **A OS fica na versão com que foi calculada** e só migra com **"reclassificar"** (a lógica pura está em `packages/shared/src/versionamento.test.ts`; aqui se confere o efeito no banco).

Por que funciona: as funções de `0005_pontuacao.sql` (`salvar_rascunho`, `publicar_versao`, `aprovar_versao`, `restaurar_versao`, `descartar_rascunho`) pegam um *advisory lock* de transação por escopo (global ou cidade). A segunda chamada espera a primeira terminar e, ao entrar, enxerga o `etag` novo e levanta `FD409` (hint `conflito_rascunho`); a API traduz em HTTP 409. O índice único parcial `uq_rascunho_escopo` (0001) é a segunda barreira.

> Pré-requisitos: `0001`, `seed.sql`, `0002`, `0003`, `0004` e `0005` aplicados; `npm run seed` e `npm run seed:os` executados; usuários de `docs/usuarios-de-teste.sql`. Os passos A e B só mexem em **rascunho** (a limpeza está no fim). Os passos D e E **publicam versões**, e versão publicada **não se apaga**: use um banco de teste/demonstração.
>
> Nos testes pelo SQL Editor o parâmetro `usuario` vai como `null`; isso é aceito pelas funções (a API sempre envia o usuário logado).

## 0. Preparar um rascunho no escopo BH

```sql
-- cria o rascunho da BH a partir da versão global vigente (etag = 1)
select salvar_rascunho('BH',
  (select conteudo from versoes_pontuacao where cidade_id is null and status = 'publicada' order by numero desc limit 1),
  null, null);

select id, numero, etag from versoes_pontuacao where cidade_id = 'BH' and status = 'rascunho';   -- 1 linha, etag 1
```

## A. Mesmo rascunho, dois salvamentos ao mesmo tempo (SQL Editor, duas abas)

**Aba 1** (segura a trava por 30 s):

```sql
begin;
select salvar_rascunho('BH',
  (select conteudo from versoes_pontuacao where cidade_id = 'BH' and status = 'rascunho'), 1, null);
select pg_sleep(30);
commit;
```

**Aba 2** (rode dentro dos 30 s, logo depois de iniciar a aba 1; também parte do `etag` 1):

```sql
select salvar_rascunho('BH',
  (select conteudo from versoes_pontuacao where cidade_id = 'BH' and status = 'rascunho'), 1, null);
```

Resultado esperado:

- a aba 2 **fica esperando** até a aba 1 dar `commit`;
- então a aba 2 falha com **`O rascunho foi alterado por outro usuário (versão 2 no servidor)…`** (SQLSTATE `FD409`, hint `conflito_rascunho`);
- a aba 1 conclui com `"etag": 2`.

Conferência (um só rascunho, `etag` 2):

```sql
select count(*) as rascunhos, max(etag) as etag from versoes_pontuacao where cidade_id = 'BH' and status = 'rascunho';   -- 1 | 2
```

## B. Pela tela: dois navegadores (ou uma janela anônima)

1. Entre com `chave@farol.teste` nos dois navegadores, em **Pontuação**, escopo **Belo Horizonte** (ou BH). O rascunho da BH aparece nos dois com o mesmo número.
2. No navegador 1 mude os pontos de qualquer opção e clique **Salvar rascunho** → aparece "Rascunho salvo".
3. No navegador 2 (que ainda tem a versão antiga na tela) mude outro campo e clique **Salvar rascunho**.

Esperado no navegador 2: caixa amarela **"Outro usuário alterou o rascunho… Suas alterações não foram salvas"** com o botão **Recarregar o rascunho**. Ao recarregar, a tela mostra o que o navegador 1 salvou. Nada foi gravado pelo navegador 2.

## C. Pela API (PowerShell 7): dois PUT simultâneos com o mesmo etag

Nunca cole senhas/chaves em chat ou arquivo; use as variáveis de ambiente da sessão.

```powershell
$env:SUPABASE_URL      = "https://SEU-REF.supabase.co"
$env:SUPABASE_ANON_KEY = Read-Host "Cole a chave anon (publishable)"
$env:FAROL_API         = "https://SUA-API.onrender.com"     # ou http://localhost:3001
$email = "chave@farol.teste"
$senha = Read-Host "Senha" -AsSecureString | ConvertFrom-SecureString -AsPlainText

$login = Invoke-RestMethod -Method Post -Uri "$($env:SUPABASE_URL)/auth/v1/token?grant_type=password" `
  -Headers @{ apikey = $env:SUPABASE_ANON_KEY } -ContentType 'application/json' `
  -Body (@{ email = $email; password = $senha } | ConvertTo-Json)
$token = $login.access_token

$estado = Invoke-RestMethod -Uri "$($env:FAROL_API)/pontuacao/versoes?escopo=BH" -Headers @{ Authorization = "Bearer $token" }
$corpo = @{ conteudo = $estado.rascunho.conteudo; etag = $estado.rascunho.etag } | ConvertTo-Json -Depth 20

1..2 | ForEach-Object -Parallel {
  $r = Invoke-WebRequest -Method Put -Uri "$($env:FAROL_API)/pontuacao/rascunho?escopo=BH" `
    -Headers @{ Authorization = "Bearer $($using:token)" } -ContentType 'application/json' `
    -Body $using:corpo -SkipHttpErrorCheck
  [pscustomobject]@{ Chamada = $_; Status = [int]$r.StatusCode; Corpo = $r.Content }
} -ThrottleLimit 2
```

Esperado: **um** `200` e **um** `409` (`"regra":"conflito_rascunho"`).

Escopo fora do alcance: com `chave@farol.teste` (só BH e CT), `GET /pontuacao/versoes?escopo=global` deve responder **403** ("A pontuação global vale para todas as cidades…") e registrar `negado:pontuacao.ler` em `auditoria`:

```sql
select acao, resultado, em from auditoria where acao like 'negado:pontuacao%' order by id desc limit 5;
```

## D. Autor não aprova a própria versão (aprovação de um segundo usuário)

1. Ligue a exigência de aprovação (SQL Editor):

   ```sql
   update configuracoes set valor = 'true'::jsonb where chave = 'pontuacao.exigir_aprovacao';
   ```

2. Com `chave@farol.teste`, na tela **Pontuação** (escopo BH): ajuste um ponto, **Salvar rascunho**, **Validar**, preencha justificativa, início de vigência e o modo **Somente novas OS** (para as OS abertas seguirem na v1 até o passo E) e clique **Enviar para aprovação**. A versão aparece como **Aguardando aprovação**.
3. Ainda como `chave@`, na lista de Versões **não há** botão Aprovar: aparece "Você enviou esta versão: outra pessoa precisa aprovar." Pela API, `POST /pontuacao/aprovar` com o `versaoId` responde **403** (`"regra":"autor_nao_aprova"`).
4. Entre com `supervisor@farol.teste`: **Pontuação** aparece no menu (somente leitura: sem edição nem publicação), a versão aguardando mostra **Aprovar e publicar**. Aprove → **Vigente**.
5. Desligue de novo, para os próximos testes:

   ```sql
   update configuracoes set valor = 'false'::jsonb where chave = 'pontuacao.exigir_aprovacao';
   ```

## E. A OS fica na versão com que foi calculada (rotina das OS abertas)

Antes, anote o vínculo das OS abertas da BH e da CT:

```sql
select o.numero, o.cidade_id, 'v' || v.numero || coalesce(' ('||v.cidade_id||')', ' (global)') as versao
  from ordens_servico o join versoes_pontuacao v on v.id = o.versao_pontuacao_id
 where o.status not in ('Concluída','Cancelada') order by o.cidade_id, o.numero;
```

Todas devem estar na **v1 global**. Para rodar a rotina sem esperar os 60 s: `npm run job:reclassificar -w @farol/api` (precisa de `apps/api/.env`).

**E1 — "Somente novas OS" não alcança as abertas.** Na tela, escopo BH: edite um ponto, salve, publique com modo **Somente novas OS** e vigência agora. Rode a rotina e repita a consulta acima: as OS da BH **continuam na v1 global** (nenhum resultado "Nova versão"):

```sql
select count(*) from resultados_prioridade where motivo_calculo like 'Nova versão%';   -- 0
```

Uma OS **nova** aberta na BH agora nasce na versão da BH (a da cidade prevalece sobre a global).

**E2 — "Reclassificar" migra as abertas, só da cidade.** Faça outro rascunho na BH (mude outro ponto), publique com modo **Reclassificar as OS abertas** e vigência agora. Rode a rotina:

```sql
select o.numero, o.cidade_id, 'v' || v.numero || coalesce(' ('||v.cidade_id||')', ' (global)') as versao
  from ordens_servico o join versoes_pontuacao v on v.id = o.versao_pontuacao_id
 where o.status not in ('Concluída','Cancelada') order by o.cidade_id, o.numero;

select o.numero, r.versao, r.motivo_calculo, r.pontos, r.calculado_em
  from resultados_prioridade r join ordens_servico o on o.id = r.os_id
 where r.motivo_calculo like 'Nova versão%' order by r.id;
```

Esperado: as OS abertas da **BH** foram para a versão **mais nova da BH** (a que reclassifica), cada uma com um resultado novo de motivo **"Nova versão vN"**, e o resultado anterior segue no histórico da OS (aba Histórico). As OS da **CT** continuam na **v1 global**. Rodar a rotina de novo não grava nada (a OS já está na versão).

**E3 — Vigência futura.** Publique (modo Reclassificar) com vigência daqui a poucos minutos: antes do horário a rotina não migra nada; depois do horário migra.

## Limpeza

```sql
-- descarta o rascunho de teste, se sobrou (aba 1 do passo A deixa o etag em 2)
select descartar_rascunho(
  (select id from versoes_pontuacao where cidade_id = 'BH' and status = 'rascunho'),
  (select etag from versoes_pontuacao where cidade_id = 'BH' and status = 'rascunho'), null);
```

(Se não houver rascunho, a função responde `FD404`: é inofensivo. Versões publicadas nos passos D e E permanecem: são imutáveis por desenho.)
