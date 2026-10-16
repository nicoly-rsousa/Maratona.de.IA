# Farol — roteiro de verificação de segurança do banco

Objetivo: confirmar, depois de aplicar `0001`, `seed.sql`, `0002` e `0003_endurecimento.sql`, que
**a chave anon não lê nem grava nada** e que quem está logado só **lê**, dentro das suas cidades.
Toda escrita passa pela API (service_role), que filtra cidade e perfil no servidor.

> Nunca cole chaves em chat, commit ou arquivo. Os comandos abaixo leem as chaves de variáveis de
> ambiente da sessão do PowerShell. **Não use a service_role neste teste**: ela ignora RLS por definição.

## 0. Pré-requisitos

- PowerShell 7 (`pwsh`). O parâmetro `-SkipHttpErrorCheck` não existe no Windows PowerShell 5.
- No painel do Supabase: **Project Settings → API**. Copie a **Project URL** e a chave **anon / publishable**
  (a pública; nunca a `service_role` / secret).

```powershell
$env:SUPABASE_URL      = "https://SEU-REF.supabase.co"
$env:SUPABASE_ANON_KEY = Read-Host "Cole a chave anon (publishable)"   # fica só nesta sessão
```

## 1. A chave anon não lê nem grava (REST)

O script tenta, para cada tabela do schema `public`, uma leitura, uma inserção, uma atualização e uma
exclusão, e chama a função de numeração de OS. **Nenhuma tentativa consegue gravar dado:**

- o `POST` vai com corpo vazio `{}`: se a permissão existisse, falharia por coluna obrigatória (HTTP 400/409), sem criar linha;
- `PATCH` e `DELETE` usam um filtro impossível (id inexistente): se a permissão existisse, afetariam 0 linhas;
- a função é chamada com uma cidade inexistente (`XX`): se executasse, falharia na chave estrangeira.

```powershell
$base = $env:SUPABASE_URL.TrimEnd('/')
$h = @{ apikey = $env:SUPABASE_ANON_KEY; Authorization = "Bearer $($env:SUPABASE_ANON_KEY)" }

function Chamar([string]$metodo, [string]$caminho, [string]$corpo = $null) {
  $p = @{ Uri = "$base$caminho"; Method = $metodo; Headers = $h; SkipHttpErrorCheck = $true }
  if ($corpo) { $p.Body = $corpo; $p.ContentType = 'application/json' }
  $r = Invoke-WebRequest @p
  [pscustomobject]@{ Status = [int]$r.StatusCode; Corpo = $r.Content }
}

# tabela = coluna usada no filtro impossível
$UUID0 = '00000000-0000-0000-0000-000000000000'
$alvos = [ordered]@{
  cidades = "id=eq.__nenhum__";               perfis = "user_id=eq.$UUID0";
  usuario_cidades = "user_id=eq.$UUID0";      versoes_pontuacao = "id=eq.$UUID0";
  regras_precedencia = "id=eq.__nenhum__";    regras_precedencia_hist = "id=eq.-1";
  contadores_os = "ano=eq.-1";                ordens_servico = "id=eq.$UUID0";
  resultados_prioridade = "id=eq.-1";         equipes = "id=eq.__nenhum__";
  despachos = "id=eq.$UUID0";                 auditoria = "id=eq.-1";
  solicitacoes = "id=eq.$UUID0"
}

$protegido = 401, 403          # permissão negada
$falhas = 0
foreach ($t in $alvos.Keys) {
  $f = $alvos[$t]
  $testes = [ordered]@{
    'SELECT' = Chamar 'GET'    "/rest/v1/${t}?select=*&limit=1"
    'INSERT' = Chamar 'POST'   "/rest/v1/$t" '{}'
    'UPDATE' = Chamar 'PATCH'  "/rest/v1/${t}?$f" '{}'
    'DELETE' = Chamar 'DELETE' "/rest/v1/${t}?$f"
  }
  foreach ($op in $testes.Keys) {
    $r = $testes[$op]
    $ok = $protegido -contains $r.Status
    if (-not $ok) { $falhas++ }
    '{0,-6} {1,-24} HTTP {2}  {3}' -f ($(if ($ok) { 'OK' } else { 'FALHA' })), "$op $t", $r.Status, $(if ($ok) { '' } else { $r.Corpo.Substring(0, [Math]::Min(120, $r.Corpo.Length)) })
  }
}

# Função de numeração de OS (NÃO deve ser executável pela anon)
$rpc = Chamar 'POST' '/rest/v1/rpc/proximo_numero_os' '{"p_cidade":"XX"}'
$okRpc = ($protegido + 404) -contains $rpc.Status          # 404 = a função nem aparece para a anon
if (-not $okRpc) { $falhas++ }
'{0,-6} {1,-24} HTTP {2}' -f ($(if ($okRpc) { 'OK' } else { 'FALHA' })), 'RPC proximo_numero_os', $rpc.Status

if ($falhas) { "`n$falhas FALHA(S): a anon tem acesso indevido. Reaplique o 0003 e rode a seção 4." } else { "`nTUDO OK: a chave anon não lê, não grava e não executa nada." }
```

**Resultado esperado:** todas as 53 linhas `OK` (13 tabelas × 4 operações + a função), com HTTP 401 ou 403
(código `42501`, "permission denied"; para a função, 404 também vale).

**Como ler uma `FALHA`:**

| HTTP | Significa |
|---|---|
| 200 (com `[]` ou dados) | a anon ainda tem `SELECT` (privilégio não revogado ou RLS desligado) |
| 400 / 409 em INSERT | a anon tem `INSERT`: a linha só não entrou por faltar coluna obrigatória |
| 204 em PATCH/DELETE | a anon tem `UPDATE`/`DELETE`: só não alterou nada por causa do filtro impossível |
| 400 / 409 / 200 no RPC | a anon executa `proximo_numero_os` |

**Antes do 0003** o mesmo script deve acusar falhas (é a lacuna do 0001); depois dele, nenhuma.

## 2. Usuário logado: só lê, só da sua cidade (opcional)

Use um usuário de teste (por exemplo, um Atendente vinculado só a BH).

```powershell
$login = Invoke-RestMethod -Method Post -Uri "$base/auth/v1/token?grant_type=password" `
  -Headers @{ apikey = $env:SUPABASE_ANON_KEY } -ContentType 'application/json' `
  -Body (@{ email = Read-Host "E-mail do usuário de teste"; password = (Read-Host "Senha" -AsSecureString | ConvertFrom-SecureString -AsPlainText) } | ConvertTo-Json)
$hu = @{ apikey = $env:SUPABASE_ANON_KEY; Authorization = "Bearer $($login.access_token)" }

# Deve devolver só OS das cidades do usuário
Invoke-RestMethod "$base/rest/v1/ordens_servico?select=numero,cidade_id" -Headers $hu
# Deve ser negado (401/403): tabelas sem policy e qualquer escrita
foreach ($t in 'versoes_pontuacao','regras_precedencia','auditoria','contadores_os') {
  $r = Invoke-WebRequest "$base/rest/v1/${t}?select=*&limit=1" -Headers $hu -SkipHttpErrorCheck
  "$t -> HTTP $([int]$r.StatusCode)"
}
$w = Invoke-WebRequest "$base/rest/v1/ordens_servico" -Method Post -Headers $hu -ContentType 'application/json' -Body '{}' -SkipHttpErrorCheck
"INSERT ordens_servico -> HTTP $([int]$w.StatusCode)   (esperado 401/403)"
```

Esperado: a primeira consulta lista só OS das cidades do usuário; o resto volta 401/403. Observação: o front
não usa esse caminho (fala só com a API); ele existe como defesa em profundidade.

## 3. A service_role não está no front

```powershell
# nenhuma ocorrência esperada em apps/web nem nos arquivos .env do front
Get-ChildItem apps/web -Recurse -File -Include *.ts,*.tsx,*.mjs,*.json,.env* -ErrorAction SilentlyContinue |
  Where-Object { $_.FullName -notmatch 'node_modules|\.next' } | Select-String -Pattern 'service_role|SERVICE_ROLE'
```

No Vercel, só devem existir `NEXT_PUBLIC_API_URL`, `NEXT_PUBLIC_SUPABASE_URL` e a chave anon. A
`SUPABASE_SERVICE_ROLE_KEY` fica só no Render (API).

## 4. Conferência direta no SQL Editor (somente leitura)

```sql
-- 4.1 RLS ligado em todas as tabelas: nenhuma linha deve ter rowsecurity = false
select tablename, rowsecurity from pg_tables where schemaname = 'public' order by tablename;

-- 4.2 Privilégios de anon/authenticated: esperado SÓ "SELECT" para authenticated em
--     perfis, usuario_cidades, ordens_servico, resultados_prioridade, despachos, equipes, solicitacoes.
--     Nenhuma linha para anon.
select grantee, table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC')
order by grantee, table_name, privilege_type;

-- 4.3 Funções executáveis por anon/authenticated/PUBLIC: esperado só pode_ver_cidade → authenticated
select routine_name, grantee, privilege_type
from information_schema.routine_privileges
where specific_schema = 'public' and grantee in ('anon', 'authenticated', 'PUBLIC')
order by routine_name, grantee;

-- 4.4 Funções com search_path fixo: proconfig deve conter search_path=public nas 4 funções do Farol
select p.proname, p.proconfig
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.proname in ('imutavel', 'bloqueia_edicao_publicada', 'proximo_numero_os', 'pode_ver_cidade');

-- 4.5 Policies: só SELECT, só para authenticated
select tablename, policyname, cmd, roles from pg_policies where schemaname = 'public' order by tablename;
```

## 5. Advisors de segurança do Supabase

1. Painel → **Advisors** (ou **Database → Advisors**) → aba **Security Advisor** → **Refresh**.
2. **Não pode haver** itens de nível erro/crítico, em especial:
   - *RLS Disabled in Public* (tabela sem RLS exposta pela API);
   - *Policy Exists RLS Disabled*;
   - *Security Definer View* (o Farol não cria views).
3. **Esperados e aceitáveis (informativos):**
   - *RLS Enabled No Policy* em `cidades`, `versoes_pontuacao`, `regras_precedencia`, `regras_precedencia_hist`,
     `contadores_os` e `auditoria`: é intencional; sem policy ninguém além da API (service_role) acessa.
   - *Leaked Password Protection Disabled* (Auth): configuração do projeto, não do schema; ligue em
     **Authentication → Providers/Policies** se o plano permitir.
   - *Extension in Public* para `pgcrypto`, se aparecer: o Farol só usa `gen_random_uuid()` (nativo do Postgres).
4. **Function Search Path Mutable** não deve aparecer para as funções do Farol (o 0003 fixa `search_path`).
5. Se aparecer algo diferente do listado, anote o nome do item e a tabela/função e traga para revisão.

Ao ligar o MCP do Supabase (somente leitura, no `.mcp.json` com `read_only=true`), a mesma checagem pode ser pedida
ao assistente com a ferramenta de Advisors (tipo *security*) e `list_tables` (RLS por tabela).

## 6. Quando criar tabelas novas (checklist de migration)

O `alter default privileges` do 0003 vale para objetos criados pelo mesmo papel que o executou (`postgres`
no SQL Editor). Mesmo assim, toda migration que cria tabela deve, explicitamente:

1. `alter table <t> enable row level security;`
2. `revoke all on <t> from anon, authenticated;`
3. conceder `select` a `authenticated` **só se** houver policy de leitura por cidade (`pode_ver_cidade`);
4. `grant all on <t> to service_role;`
5. repetir a seção 1 deste roteiro.
