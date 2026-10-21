[CmdletBinding()]
param(
  [switch]$Gravar
)

$ErrorActionPreference = 'Stop'

$Raiz = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location -LiteralPath $Raiz

function Invoke-NodeChecked {
  param([string[]]$Argumentos)

  & node @Argumentos
  if ($LASTEXITCODE -ne 0) {
    throw "Falha ao executar: node $($Argumentos -join ' ')"
  }
}

Write-Host '1/3 Testando a trava e os parsers do importador...'
Invoke-NodeChecked @('--test', 'scripts/importar-v2/importar.test.mjs')

Write-Host '2/3 Gerando o relatório da importação (sem gravar no banco)...'
Invoke-NodeChecked @('scripts/importar-v2/importar.mjs')

if (-not $Gravar) {
  Write-Host 'Concluído sem gravação. Para gravar somente no Supabase local, execute novamente com -Gravar.'
  exit 0
}

if (-not (Test-Path -LiteralPath '.env.docker' -PathType Leaf)) {
  throw 'Falta .env.docker. Copie .env.docker.example e preencha somente as credenciais do Supabase local.'
}

Write-Host '3/3 Confirmando o destino local antes da gravação...'
$Preflight = @'
import { destinoLocal } from './scripts/importar-v2/lib.mjs';
const destino = destinoLocal(process.env.DATABASE_URL);
if (!destino.ok) {
  console.error(`Gravação BLOQUEADA: ${destino.motivo}`);
  process.exit(2);
}
console.log('Destino local confirmado.');
'@

& node --env-file=.env.docker --input-type=module -e $Preflight
if ($LASTEXITCODE -ne 0) {
  throw 'Gravação cancelada: DATABASE_URL não aponta para 127.0.0.1/localhost na porta 54322.'
}

Write-Host 'Gravando a importação no Supabase local...'
Invoke-NodeChecked @('--env-file=.env.docker', 'scripts/importar-v2/importar.mjs', '--gravar')
Write-Host 'Importação local concluída.'
