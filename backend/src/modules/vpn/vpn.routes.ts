import { execFile } from "child_process";
import { Router } from "express";
import { promisify } from "util";
import { z } from "zod";
import { env } from "../../config/env";
import { requireAuth } from "../../middlewares/auth";

const execFileAsync = promisify(execFile);
const vpnRouter = Router();

type VpnStatusResponse = {
  supported: boolean;
  configured: boolean;
  connected: boolean;
  connectionName: string | null;
  message?: string;
};

const isWindows = process.platform === "win32";
const configuredConnectionName = env.VPN_CONNECTION_NAME?.trim() ?? "";

function toPowerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

async function runPowerShell(command: string): Promise<string> {
  const { stdout } = await execFileAsync(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", command],
    { windowsHide: true, maxBuffer: 1024 * 1024 },
  );
  return String(stdout ?? "");
}

async function getVpnStatus(): Promise<VpnStatusResponse> {
  if (!isWindows) {
    return {
      supported: false,
      configured: false,
      connected: false,
      connectionName: null,
      message: "Controle de VPN disponivel somente no Windows.",
    };
  }
  if (!configuredConnectionName) {
    return {
      supported: true,
      configured: false,
      connected: false,
      connectionName: null,
      message: "VPN_CONNECTION_NAME nao configurado no backend.",
    };
  }

  const escapedName = toPowerShellString(configuredConnectionName);
  const output = await runPowerShell(
    `$vpn = Get-VpnConnection -Name ${escapedName} -ErrorAction SilentlyContinue; if ($null -eq $vpn) { Write-Output 'NOT_FOUND' } else { Write-Output $vpn.ConnectionStatus }`,
  );
  const status = output.trim();
  if (status === "NOT_FOUND") {
    return {
      supported: true,
      configured: false,
      connected: false,
      connectionName: configuredConnectionName,
      message: "Conexao VPN nao encontrada no Windows.",
    };
  }

  return {
    supported: true,
    configured: true,
    connected: status.toLowerCase() === "connected",
    connectionName: configuredConnectionName,
  };
}

vpnRouter.use(requireAuth);

vpnRouter.get("/status", async (_req, res, next) => {
  try {
    const status = await getVpnStatus();
    res.json(status);
  } catch (error) {
    next(error);
  }
});

vpnRouter.post("/toggle", async (req, res, next) => {
  try {
    const payload = z.object({ enabled: z.boolean() }).parse(req.body);
    const before = await getVpnStatus();

    if (!before.supported) {
      res.status(400).json({ message: before.message ?? "Controle de VPN indisponivel." });
      return;
    }
    if (!before.configured || !before.connectionName) {
      res.status(400).json({ message: before.message ?? "VPN nao configurada." });
      return;
    }

    if (before.connected !== payload.enabled) {
      const escapedName = toPowerShellString(before.connectionName);
      if (payload.enabled) {
        await runPowerShell(`rasdial ${escapedName}`);
      } else {
        await runPowerShell(`rasdial ${escapedName} /disconnect`);
      }
    }

    const after = await getVpnStatus();
    res.json(after);
  } catch (error) {
    next(error);
  }
});

export { vpnRouter };
