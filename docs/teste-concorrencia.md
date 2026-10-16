# Farol — roteiro de teste de concorrência (despacho)

Objetivo: provar que **duas designações ao mesmo tempo para a mesma OS** resultam em **uma só** equipe
designada e **um 409** para a outra, e que a **capacidade** da equipe nunca é ultrapassada.

Por que funciona: `designar_equipe` (migration `0004_status_despacho.sql`) trava a OS e depois a equipe com
`FOR UPDATE`. A segunda chamada espera a primeira terminar e, ao entrar, vê o despacho ativo (ou a equipe cheia)
e levanta `FD409`; a API traduz em HTTP 409. O índice único parcial `uq_despacho_ativo` é a segunda barreira.

> Pré-requisitos: `0001`, `seed.sql`, `0002`, `0003`, `0004` aplicados; `npm run seed` e `npm run seed:os`
> executados (há OS "Aguardando despacho" em BH). Os testes abaixo alteram dados (designam equipes): a limpeza
> está no passo final. Use um banco de **teste/demonstração**.

## 0. Escolher a OS e as equipes

No SQL Editor:

```sql
-- OS livres para designar (sem qualificação exigida, para não cair na regra de exceção)
select id as os_id, numero from ordens_servico
 where cidade_id = 'BH' and status = 'Aguardando despacho' and exige_qualificacao is null
 order by numero limit 3;

-- capacidade e carga atual das equipes de BH
select e.id, e.capacidade,
       (select count(*) from despachos d where d.equipe_id = e.id and d.estado in ('designada','a_caminho','em_execucao')) as carga
  from equipes e where e.cidade_id = 'BH' order by e.id;
```

Anote dois `os_id` (`OS1`, `OS2`). Com os dados demonstrativos: `BH-A` tem capacidade 2 e `BH-B` capacidade 1.

## A. Mesma OS, duas equipes ao mesmo tempo (SQL Editor, duas abas)

**Aba 1** (segura a trava por 30 s):

```sql
begin;
select designar_equipe('OS1', 'BH-A', false, false, null, null);
select pg_sleep(30);
commit;
```

**Aba 2** (rode dentro dos 30 s, logo depois de iniciar a aba 1):

```sql
select designar_equipe('OS1', 'BH-B', false, false, null, null);
```

Resultado esperado:

- a aba 2 **fica esperando** até a aba 1 dar `commit`;
- então a aba 2 falha com **`A OS BH-2026-… já tem despacho ativo…`** (SQLSTATE `FD409`, hint `despacho_ativo`);
- a aba 1 conclui com sucesso.

Conferência:

```sql
select equipe_id, estado from despachos where os_id = 'OS1' order by criado_em;   -- exatamente 1 linha, 'designada'
select tipo, para from eventos_os where os_id = 'OS1' order by id;                -- exatamente 1 evento 'designacao'
```

## B. Capacidade: duas OS diferentes para a equipe de vaga única (SQL Editor, duas abas)

`BH-B` tem capacidade 1 e carga 0 (se não tiver, remova as equipes antes — passo de limpeza).

**Aba 1**:

```sql
begin;
select designar_equipe('OS2', 'BH-B', false, false, null, null);
select pg_sleep(30);
commit;
```

**Aba 2** (dentro dos 30 s; use outra OS livre, `OS3`):

```sql
select designar_equipe('OS3', 'BH-B', false, false, null, null);
```

Esperado: a aba 2 espera e depois falha com **`Capacidade esgotada: a equipe BH-B já está com 1/1…`**
(`FD409`, hint `capacidade`). Nem `p_excecao = true` libera esse limite.

```sql
select count(*) from despachos where equipe_id = 'BH-B' and estado in ('designada','a_caminho','em_execucao');  -- 1
```

## C. Pela API (PowerShell 7): dois POST simultâneos

Precisa de um usuário com perfil que possa designar (Despachante ou Supervisor — veja `docs/usuarios-de-teste.sql`).
Nunca cole senhas/chaves em chat ou arquivo; use as variáveis de ambiente da sessão.

```powershell
$env:SUPABASE_URL      = "https://SEU-REF.supabase.co"
$env:SUPABASE_ANON_KEY = Read-Host "Cole a chave anon (publishable)"
$env:FAROL_API         = "https://SUA-API.onrender.com"     # ou http://localhost:3001
$email = Read-Host "E-mail do despachante"
$senha = Read-Host "Senha" -AsSecureString | ConvertFrom-SecureString -AsPlainText

$login = Invoke-RestMethod -Method Post -Uri "$($env:SUPABASE_URL)/auth/v1/token?grant_type=password" `
  -Headers @{ apikey = $env:SUPABASE_ANON_KEY } -ContentType 'application/json' `
  -Body (@{ email = $email; password = $senha } | ConvertTo-Json)
$token = $login.access_token

$osId = Read-Host "os_id (OS1, Aguardando despacho)"
$pedidos = @('BH-A', 'BH-B')      # duas equipes disputando a MESMA OS

$pedidos | ForEach-Object -Parallel {
  $r = Invoke-WebRequest -Method Post -Uri "$($env:FAROL_API)/os/$($using:osId)/despacho" `
    -Headers @{ Authorization = "Bearer $($using:token)" } -ContentType 'application/json' `
    -Body (@{ equipe = $_ } | ConvertTo-Json) -SkipHttpErrorCheck
  [pscustomobject]@{ Equipe = $_; Status = [int]$r.StatusCode; Corpo = $r.Content }
} -ThrottleLimit 2
```

Esperado: **um** `201` e **um** `409` (`"regra":"despacho_ativo"`). Repita trocando as duas chamadas por
duas **OS diferentes** na equipe `BH-B` para ver o `409` de `capacidade`.

## Limpeza

```sql
-- devolve cada OS à fila (preserva o registro do despacho como 'removida')
select remover_equipe('OS1', 'fim do teste de concorrência', null);
select remover_equipe('OS2', 'fim do teste de concorrência', null);
```

(Se uma OS não tiver despacho ativo, a função responde `FD409 sem_despacho`: é inofensivo.)
