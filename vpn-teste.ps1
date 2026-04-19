param(
  [ValidateSet("menu", "criar", "remover", "listar", "recriar")]
  [string]$acao = "menu"
)

$vpnName = "VPN_TESTE_MC"
$serverAddress = "203.0.113.10"
$l2tpPsk = "teste123"

function Test-Admin {
  $currentUser = [Security.Principal.WindowsIdentity]::GetCurrent()
  $principal = New-Object Security.Principal.WindowsPrincipal($currentUser)
  return $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}

function Show-Header {
  Clear-Host
  Write-Host "==========================================" -ForegroundColor Cyan
  Write-Host "      VPN DE TESTE - PORTAL MC SERVICOS" -ForegroundColor Cyan
  Write-Host "==========================================" -ForegroundColor Cyan
  Write-Host "VPN alvo: $vpnName"
  Write-Host ""
}

function Criar-VpnTeste {
  try {
    $exists = Get-VpnConnection -Name $vpnName -ErrorAction SilentlyContinue
    if ($exists) {
      Write-Host "A VPN de teste ja existe: $vpnName" -ForegroundColor Yellow
      return
    }

    Add-VpnConnection `
      -Name $vpnName `
      -ServerAddress $serverAddress `
      -TunnelType L2tp `
      -L2tpPsk $l2tpPsk `
      -AuthenticationMethod Pap `
      -EncryptionLevel Optional `
      -RememberCredential `
      -Force | Out-Null

    Write-Host "VPN de teste criada com sucesso: $vpnName" -ForegroundColor Green
  } catch {
    Write-Host "Falha ao criar VPN de teste: $($_.Exception.Message)" -ForegroundColor Red
  }
}

function Remover-VpnTeste {
  try {
    $exists = Get-VpnConnection -Name $vpnName -ErrorAction SilentlyContinue
    if (-not $exists) {
      Write-Host "VPN de teste nao encontrada." -ForegroundColor Yellow
      return
    }

    Remove-VpnConnection -Name $vpnName -Force
    Write-Host "VPN de teste removida: $vpnName" -ForegroundColor Green
  } catch {
    Write-Host "Falha ao remover VPN de teste: $($_.Exception.Message)" -ForegroundColor Red
  }
}

function Listar-Vpn {
  try {
    $vpns = Get-VpnConnection -ErrorAction SilentlyContinue
    if (-not $vpns) {
      Write-Host "Nenhuma VPN encontrada neste computador." -ForegroundColor Yellow
      return
    }

    $vpns |
      Select-Object Name, ServerAddress, TunnelType, ConnectionStatus |
      Format-Table -AutoSize
  } catch {
    Write-Host "Falha ao listar VPNs: $($_.Exception.Message)" -ForegroundColor Red
  }
}

function Recriar-VpnTeste {
  Remover-VpnTeste
  Start-Sleep -Milliseconds 300
  Criar-VpnTeste
}

function Rodar-Acao {
  param([string]$cmd)

  Show-Header
  switch ($cmd) {
    "criar"   { Criar-VpnTeste }
    "remover" { Remover-VpnTeste }
    "listar"  { Listar-Vpn }
    "recriar" { Recriar-VpnTeste }
    default   { Write-Host "Acao invalida: $cmd" -ForegroundColor Red }
  }
}

if (-not (Test-Admin)) {
  Write-Host ""
  Write-Host "Abra o arquivo .bat como Administrador para usar este script." -ForegroundColor Red
  Write-Host ""
  Start-Sleep -Seconds 2
  exit 1
}

if ($acao -ne "menu") {
  Rodar-Acao -cmd $acao
  Write-Host ""
  Read-Host "Pressione Enter para sair"
  exit 0
}

do {
  Show-Header
  Write-Host "1) Criar VPN de teste"
  Write-Host "2) Remover VPN de teste"
  Write-Host "3) Listar VPNs"
  Write-Host "4) Recriar VPN de teste"
  Write-Host "0) Sair"
  Write-Host ""
  $option = Read-Host "Escolha uma opcao"

  switch ($option) {
    "1" { Rodar-Acao -cmd "criar" }
    "2" { Rodar-Acao -cmd "remover" }
    "3" { Rodar-Acao -cmd "listar" }
    "4" { Rodar-Acao -cmd "recriar" }
    "0" { break }
    default {
      Write-Host ""
      Write-Host "Opcao invalida." -ForegroundColor Yellow
    }
  }

  if ($option -ne "0") {
    Write-Host ""
    Read-Host "Pressione Enter para voltar ao menu"
  }
} while ($true)
