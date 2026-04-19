param()

$ErrorActionPreference = "Stop"

$agentRoot = Resolve-Path (Join-Path $PSScriptRoot "..")
$payloadDir = Join-Path $agentRoot "installer\payload"

Write-Host "Preparando build do agente..."
Push-Location $agentRoot
try {
  npm run build

  if (Test-Path $payloadDir) {
    Remove-Item -Recurse -Force $payloadDir
  }
  New-Item -ItemType Directory -Path $payloadDir | Out-Null

  Copy-Item -Recurse -Force (Join-Path $agentRoot "dist") (Join-Path $payloadDir "dist")
  Copy-Item -Force (Join-Path $agentRoot "package.json") (Join-Path $payloadDir "package.json")
  Copy-Item -Force (Join-Path $agentRoot ".env.example") (Join-Path $payloadDir ".env.example")
  Copy-Item -Force (Join-Path $agentRoot "run-agent.cmd") (Join-Path $payloadDir "run-agent.cmd")
  Copy-Item -Force (Join-Path $agentRoot "run-agent.vbs") (Join-Path $payloadDir "run-agent.vbs")

  Write-Host "Instalando dependencias de producao no payload..."
  npm install --omit=dev --package-lock=false --prefix $payloadDir

  $selfPackagePath = Join-Path $payloadDir "node_modules\mcservicos-vpn-agent"
  if (Test-Path $selfPackagePath) {
    Remove-Item -Recurse -Force $selfPackagePath
  }

  Write-Host "Payload preparado em $payloadDir"
}
finally {
  Pop-Location
}
