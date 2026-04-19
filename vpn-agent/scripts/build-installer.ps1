param(
  [string]$IsccPath = "iscc"
)

$ErrorActionPreference = "Stop"

$agentRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$issFile = Join-Path $agentRoot "installer\MCServicosVpnAgent.iss"

& (Join-Path $PSScriptRoot "prepare-installer.ps1")

Write-Host "Gerando instalador com Inno Setup..."
& $IsccPath $issFile

Write-Host "Instalador final em $agentRoot\installer\output"
