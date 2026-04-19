# MC Servicos VPN Agent (Windows)

Agente local para permitir que o portal online ligue/desligue a VPN no computador do usuário.

## Requisitos

- Windows
- Node.js 18+
- Uma conexão VPN já configurada no Windows

## Configuração

1. Copie `.env.example` para `.env`.
2. Ajuste:
   - `VPN_CONNECTION_NAME`: nome exato da conexão VPN no Windows.
   - `PORT` (opcional, padrão `48321`).
   - `ALLOWED_ORIGINS`: URL(s) do portal separadas por vírgula.
   - `AGENT_API_TOKEN` (opcional, recomendado em produção).

## Execução local

```bash
npm install
npm run dev
```

## Build e execução

```bash
npm run build
npm start
```

## Gerar instalador .exe (Inno Setup)

1. Instale o Inno Setup no Windows.
2. Prepare payload e compile:

```powershell
./scripts/build-installer.ps1
```

Se o comando `iscc` não estiver no PATH:

```powershell
./scripts/build-installer.ps1 -IsccPath "C:\Program Files (x86)\Inno Setup 6\ISCC.exe"
```

O instalador será gerado em:

- `vpn-agent/installer/output/mcservicos-vpn-agent-installer.exe`

### Fluxo do script

- Faz build do agente (`dist`)
- Prepara `installer/payload` com arquivos necessários
- Instala dependências de produção no payload
- Compila o instalador Inno Setup

## Distribuição no portal

Para o botão "Instalar agora" funcionar com URL padrão:

1. Copie o `.exe` gerado para:
   - `frontend/public/downloads/mcservicos-vpn-agent-installer.exe`
2. Faça deploy do frontend.

Ou configure no frontend:

- `VITE_VPN_AGENT_INSTALLER_URL=https://seu-dominio/arquivo.exe`

## Endpoints

- `GET /v1/health`
- `GET /v1/vpn/status`
- `GET /v1/vpn/connections`
- `POST /v1/vpn/config` com body `{ "connectionName": "Minha VPN" }`
- `POST /v1/vpn/toggle` com body `{ "enabled": true|false }`

## Integração com o frontend

No frontend:

- `VITE_VPN_AGENT_URL=http://127.0.0.1:48321`
- `VITE_VPN_AGENT_INSTALLER_URL=/downloads/mcservicos-vpn-agent-installer.exe`

Se o agente não estiver rodando, a UI mostra VPN inativa e oferece instalação.
