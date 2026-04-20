import { execFile, spawn } from "child_process";
import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { promises as fs } from "fs";
import path from "path";
import { promisify } from "util";

dotenv.config();

const execFileAsync = promisify(execFile);
const app = express();

const port = Number(process.env.PORT || 48321);
const configuredFromEnv = (process.env.VPN_CONNECTION_NAME || "").trim();
const configuredUsername = (process.env.VPN_USERNAME || "").trim();
const configuredPassword = (process.env.VPN_PASSWORD || "").trim();
const configuredDomain = (process.env.VPN_DOMAIN || "").trim();
const apiToken = (process.env.AGENT_API_TOKEN || "").trim();
const allowedOrigins = (process.env.ALLOWED_ORIGINS || "http://localhost:5173")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const configFilePath = process.env.AGENT_CONFIG_PATH?.trim()
  ? path.resolve(process.env.AGENT_CONFIG_PATH.trim())
  : path.resolve(process.cwd(), "agent-config.json");

let configuredConnectionName = configuredFromEnv;
const userPhonebookPath = process.platform === "win32" && process.env.APPDATA
  ? path.join(process.env.APPDATA, "Microsoft", "Network", "Connections", "Pbk", "rasphone.pbk")
  : "";

type VpnStatusResponse = {
  available: boolean;
  connected: boolean;
  configured: boolean;
  connectionExists: boolean;
  connectionName: string | null;
  needsSelection: boolean;
  message?: string;
};

type AgentConfig = {
  connectionName: string;
};

type ExecError = Error & {
  stdout?: string;
  stderr?: string;
};

function quotePowerShell(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function runPowerShell(command: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
    {
      windowsHide: true,
      maxBuffer: 1024 * 1024,
    },
  );
  return String(stdout ?? "");
}

async function runRasdial(args: string[]): Promise<string> {
  const { stdout, stderr } = await execFileAsync("rasdial.exe", args, {
    windowsHide: true,
    maxBuffer: 1024 * 1024,
  });
  return `${String(stdout ?? "")}\n${String(stderr ?? "")}`.trim();
}

function launchDetached(filePath: string, args: string[] = []): void {
  const child = spawn(filePath, args, {
    detached: true,
    windowsHide: true,
    stdio: "ignore",
  });
  child.unref();
}

function buildRasdialArgs(connectionName: string, extra: string[] = []): string[] {
  const args = [connectionName, ...extra];
  if (userPhonebookPath) {
    args.push(`/PHONEBOOK:${userPhonebookPath}`);
  }
  return args;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function triggerRasdialDisconnect(connectionName: string): Promise<void> {
  launchDetached("rasdial.exe", buildRasdialArgs(connectionName, ["/disconnect"]));
}

async function waitForVpnConnectedState(
  connectionName: string,
  expectedConnected: boolean,
  timeoutMs: number,
): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const connected = await isVpnConnectedByName(connectionName);
    if (connected === expectedConnected) {
      return true;
    }
    await sleep(200);
  }
  return false;
}

async function isVpnConnectedByName(connectionName: string): Promise<boolean> {
  const escapedName = quotePowerShell(connectionName);
  const statusOutput = await runPowerShell(
    `$vpn = Get-VpnConnection -Name ${escapedName} -ErrorAction SilentlyContinue; if ($null -eq $vpn) { Write-Output 'NOT_FOUND' } else { Write-Output $vpn.ConnectionStatus }`,
  );
  const status = statusOutput.trim().toLowerCase();
  if (status === "connected") return true;
  if (status === "disconnected") return false;
  if (status === "not_found") {
    const rasdialOutput = await runPowerShell("rasdial");
    return rasdialOutput.toLowerCase().includes(connectionName.toLowerCase());
  }
  return false;
}

async function tryConnectViaRasphone(connectionName: string): Promise<boolean> {
  const escaped = connectionName.replace(/"/g, '""');
  try {
    await runPowerShell(
      "Get-Process -Name 'rasphone' -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.Id -Force -ErrorAction SilentlyContinue }",
    );
  } catch {
    // Continua mesmo que não exista processo antigo para encerrar.
  }
  await runPowerShell(
    `Start-Process -FilePath 'rasphone.exe' -ArgumentList '-d "${escaped}"' -WindowStyle Minimized`,
  );
  if (await waitForVpnConnectedState(connectionName, true, 4500)) {
    return true;
  }
  await runPowerShell(
    `Start-Process -FilePath 'rasphone.exe' -ArgumentList '-d "${escaped}"'`,
  );
  return waitForVpnConnectedState(connectionName, true, 14000);
}

async function loadAgentConfig(): Promise<void> {
  try {
    const raw = await fs.readFile(configFilePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<AgentConfig>;
    if (typeof parsed.connectionName === "string" && parsed.connectionName.trim()) {
      configuredConnectionName = parsed.connectionName.trim();
      return;
    }
  } catch {
    // Usa fallback do .env se o arquivo não existir.
  }
  if (configuredFromEnv) {
    await saveAgentConfig(configuredFromEnv);
  }
}

async function saveAgentConfig(connectionName: string): Promise<void> {
  const payload: AgentConfig = { connectionName };
  configuredConnectionName = connectionName;
  await fs.writeFile(configFilePath, JSON.stringify(payload, null, 2), "utf8");
}

async function listVpnConnections(): Promise<string[]> {
  if (process.platform !== "win32") return [];
  const output = await runPowerShell(`
    $names = New-Object System.Collections.Generic.List[string]
    try {
      Get-VpnConnection -AllUserConnection -ErrorAction Stop |
        Select-Object -ExpandProperty Name |
        ForEach-Object {
          if ($_ -and $_.Trim().Length -gt 0) { $names.Add($_.Trim()) }
        }
    } catch {}

    try {
      Get-VpnConnection -ErrorAction SilentlyContinue |
        Select-Object -ExpandProperty Name |
        ForEach-Object {
          if ($_ -and $_.Trim().Length -gt 0) { $names.Add($_.Trim()) }
        }
    } catch {}

    $pbkPaths = @(
      (Join-Path $env:APPDATA 'Microsoft\\Network\\Connections\\Pbk\\rasphone.pbk'),
      (Join-Path $env:ProgramData 'Microsoft\\Network\\Connections\\Pbk\\rasphone.pbk')
    )

    foreach ($pbk in $pbkPaths) {
      if (-not (Test-Path $pbk)) { continue }
      Get-Content -Path $pbk -ErrorAction SilentlyContinue |
        Where-Object { $_ -match '^\\[(.+)\\]$' } |
        ForEach-Object {
          $entry = $matches[1].Trim()
          if ($entry) { $names.Add($entry) }
        }
    }

    $names | Sort-Object -Unique | ForEach-Object { Write-Output $_ }
  `);
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function getVpnStatus(): Promise<VpnStatusResponse> {
  if (process.platform !== "win32") {
    return {
      available: false,
      connected: false,
      configured: false,
      connectionExists: false,
      connectionName: configuredConnectionName || null,
      needsSelection: true,
      message: "Agente VPN disponível apenas no Windows.",
    };
  }

  if (!configuredConnectionName) {
    return {
      available: false,
      connected: false,
      configured: false,
      connectionExists: false,
      connectionName: null,
      needsSelection: true,
      message: "Selecione a VPN para configurar o agente.",
    };
  }

  const allConnections = await listVpnConnections();
  const connectionExists = allConnections.some(
    (name) => name.toLowerCase() === configuredConnectionName.toLowerCase(),
  );

  if (!connectionExists) {
    return {
      available: false,
      connected: false,
      configured: true,
      connectionExists: false,
      connectionName: configuredConnectionName,
      needsSelection: true,
      message: "VPN configurada não foi encontrada. Selecione novamente.",
    };
  }

  const name = quotePowerShell(configuredConnectionName);
  const statusOutput = await runPowerShell(
    `$vpn = Get-VpnConnection -Name ${name} -ErrorAction SilentlyContinue; if ($null -eq $vpn) { Write-Output 'NOT_FOUND' } else { Write-Output $vpn.ConnectionStatus }`,
  );
  const status = statusOutput.trim();

  if (status === "NOT_FOUND") {
    const rasdialOutput = await runPowerShell("rasdial");
    const connectedByRasdial = rasdialOutput.toLowerCase().includes(configuredConnectionName.toLowerCase());
    return {
      available: true,
      connected: connectedByRasdial,
      configured: true,
      connectionExists: true,
      connectionName: configuredConnectionName,
      needsSelection: false,
      message: connectedByRasdial ? undefined : "VPN detectada no Windows. Clique no toggle para conectar.",
    };
  }

  return {
    available: true,
    connected: status.toLowerCase() === "connected",
    configured: true,
    connectionExists: true,
    connectionName: configuredConnectionName,
    needsSelection: false,
  };
}

async function setVpnEnabled(enabled: boolean): Promise<VpnStatusResponse> {
  if (process.platform !== "win32") {
    return getVpnStatus();
  }
  const connectionName = configuredConnectionName.trim();
  if (!connectionName) {
    return getVpnStatus();
  }

  try {
    if (enabled) {
      if (!configuredUsername || !configuredPassword) {
        const connectedViaRasphone = await tryConnectViaRasphone(connectionName);
        if (connectedViaRasphone) {
          return getVpnStatus();
        }
        const refreshed = await getVpnStatus();
        return {
          ...refreshed,
          message:
            "Não foi possível conectar automaticamente pelo clique do Windows. Verifique se o perfil VPN conecta sem prompt no botão Conectar do sistema.",
        };
      }

      const credentialArgs: string[] = [];
      if (configuredUsername && configuredPassword) {
        credentialArgs.push(configuredUsername, configuredPassword);
        if (configuredDomain) {
          credentialArgs.push(`/DOMAIN:${configuredDomain}`);
        }
      }
      await runRasdial(buildRasdialArgs(connectionName, credentialArgs));
    } else {
      try {
        await triggerRasdialDisconnect(connectionName);
      } catch {
        // Ignora e tenta validação por status logo abaixo.
      }

      if (!(await waitForVpnConnectedState(connectionName, false, 700))) {
        try {
          launchDetached("rasdial.exe", ["/disconnect"]);
        } catch {
          // Segunda tentativa também pode falhar quando já não há sessão ativa.
        }
      }

      if (!(await waitForVpnConnectedState(connectionName, false, 700))) {
        const refreshed = await getVpnStatus();
        if (!refreshed.connected) {
          return refreshed;
        }
        return {
          ...refreshed,
          message:
            "Comando de desligar enviado, mas o Windows ainda está finalizando a desconexão. Tente novamente em instantes.",
        };
      }
    }
  } catch (error) {
    const executionError = error as ExecError;
    const detail = `${executionError.stdout ?? ""}\n${executionError.stderr ?? ""}\n${executionError.message ?? ""}`.trim();
    const refreshed = await getVpnStatus();
    return {
      ...refreshed,
      message:
        detail ||
        (enabled
          ? "Falha ao ligar a VPN pelo Windows. Verifique se usuário/senha da VPN estão salvos."
          : "Falha ao desligar a VPN pelo Windows."),
    };
  }
  return getVpnStatus();
}

app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origem não permitida."));
    },
  }),
);
app.use(express.json());

app.use((req, res, next) => {
  if (!apiToken) {
    next();
    return;
  }
  const incoming = req.header("x-agent-token")?.trim();
  if (!incoming || incoming !== apiToken) {
    res.status(401).json({ message: "Token do agente inválido." });
    return;
  }
  next();
});

app.get("/v1/health", (_req, res) => {
  res.json({ ok: true, service: "mcservicos-vpn-agent" });
});

app.get("/v1/vpn/status", async (_req, res) => {
  const status = await getVpnStatus();
  res.json(status);
});

app.get("/v1/vpn/connections", async (_req, res) => {
  const connections = await listVpnConnections();
  res.json({
    available: process.platform === "win32",
    selectedConnectionName: configuredConnectionName || null,
    connections,
    message:
      process.platform === "win32"
        ? undefined
        : "Agente VPN disponível apenas no Windows.",
  });
});

app.post("/v1/vpn/config", async (req, res) => {
  const rawName = String(req.body?.connectionName ?? "").trim();
  if (!rawName) {
    res.status(400).json({ message: "Nome da conexão VPN é obrigatório." });
    return;
  }
  const connections = await listVpnConnections();
  const exists = connections.some((name) => name.toLowerCase() === rawName.toLowerCase());
  if (!exists) {
    res.status(400).json({
      message: "VPN informada não foi encontrada neste computador.",
      availableConnections: connections,
    });
    return;
  }
  const canonicalName = connections.find((name) => name.toLowerCase() === rawName.toLowerCase()) ?? rawName;
  await saveAgentConfig(canonicalName);
  const status = await getVpnStatus();
  res.json(status);
});

app.post("/v1/vpn/toggle", async (req, res) => {
  const enabled = Boolean(req.body?.enabled);
  const status = await setVpnEnabled(enabled);
  res.json(status);
});

void (async () => {
  await loadAgentConfig();
  app.listen(port, "127.0.0.1", () => {
    // eslint-disable-next-line no-console
    console.log(`VPN Agent local ativo em http://127.0.0.1:${port}`);
  });
})();
