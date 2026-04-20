export type AgentVpnStatus = {
  agentReachable: boolean;
  available: boolean;
  connected: boolean;
  configured: boolean;
  connectionExists: boolean;
  connectionName: string | null;
  needsSelection: boolean;
  message?: string;
};

type AgentStatusPayload = {
  available?: unknown;
  connected?: unknown;
  configured?: unknown;
  connectionExists?: unknown;
  connectionName?: unknown;
  needsSelection?: unknown;
  message?: unknown;
};

export type AgentVpnConnections = {
  available: boolean;
  selectedConnectionName: string | null;
  connections: string[];
  message?: string;
};

const AGENT_BASE_URL = import.meta.env.VITE_VPN_AGENT_URL ?? "http://127.0.0.1:48321";
export const VPN_AGENT_INSTALLER_URL =
  import.meta.env.VITE_VPN_AGENT_INSTALLER_URL ?? "/downloads/mcservicos-vpn-agent-installer.exe";
const AGENT_DISCOVERY_TIMEOUT_MS = 1200;
const AGENT_REQUEST_TIMEOUT_MS = 6000;
const AGENT_TOGGLE_TIMEOUT_MS = 12000;
const AGENT_HEALTH_CACHE_TTL_MS = 4000;

let cachedHealth: { ok: boolean; checkedAt: number } | null = null;

async function fetchWithTimeout(url: string, init?: RequestInit, timeoutMs = AGENT_REQUEST_TIMEOUT_MS): Promise<Response> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
  } finally {
    window.clearTimeout(timeout);
  }
}

async function checkAgentHealth(force = false): Promise<boolean> {
  const now = Date.now();
  if (!force && cachedHealth && now - cachedHealth.checkedAt < AGENT_HEALTH_CACHE_TTL_MS) {
    return cachedHealth.ok;
  }

  try {
    const response = await fetchWithTimeout(`${AGENT_BASE_URL}/v1/health`, undefined, AGENT_DISCOVERY_TIMEOUT_MS);
    const ok = response.ok;
    cachedHealth = { ok, checkedAt: Date.now() };
    return ok;
  } catch {
    cachedHealth = { ok: false, checkedAt: Date.now() };
    return false;
  }
}

export async function getAgentVpnStatus(): Promise<AgentVpnStatus> {
  const reachable = await checkAgentHealth();
  if (!reachable) {
    return {
      agentReachable: false,
      available: false,
      connected: false,
      configured: false,
      connectionExists: false,
      connectionName: null,
      needsSelection: true,
      message: "Agente VPN não detectado neste computador.",
    };
  }

  try {
    const response = await fetchWithTimeout(`${AGENT_BASE_URL}/v1/vpn/status`, undefined, AGENT_REQUEST_TIMEOUT_MS);
    if (!response.ok) {
      return {
        agentReachable: true,
        available: false,
        connected: false,
        configured: false,
        connectionExists: false,
        connectionName: null,
        needsSelection: true,
        message: "Agente VPN indisponível.",
      };
    }
    const payload = (await response.json()) as AgentStatusPayload;
    return {
      agentReachable: true,
      available: Boolean(payload.available),
      connected: Boolean(payload.connected),
      configured: Boolean(payload.configured),
      connectionExists: Boolean(payload.connectionExists),
      connectionName: typeof payload.connectionName === "string" && payload.connectionName ? payload.connectionName : null,
      needsSelection: Boolean(payload.needsSelection),
      message: typeof payload.message === "string" ? payload.message : undefined,
    };
  } catch {
    return {
      agentReachable: true,
      available: false,
      connected: false,
      configured: false,
      connectionExists: false,
      connectionName: null,
      needsSelection: true,
      message: "Agente VPN respondeu, mas demorou para retornar status. Tente novamente em instantes.",
    };
  }
}

export async function setAgentVpnEnabled(enabled: boolean): Promise<AgentVpnStatus> {
  try {
    const response = await fetchWithTimeout(`${AGENT_BASE_URL}/v1/vpn/toggle`, {
      method: "POST",
      body: JSON.stringify({ enabled }),
    }, AGENT_TOGGLE_TIMEOUT_MS);
    if (!response.ok) {
      return getAgentVpnStatus();
    }
    const payload = (await response.json()) as AgentStatusPayload;
    return {
      agentReachable: true,
      available: Boolean(payload.available),
      connected: Boolean(payload.connected),
      configured: Boolean(payload.configured),
      connectionExists: Boolean(payload.connectionExists),
      connectionName: typeof payload.connectionName === "string" && payload.connectionName ? payload.connectionName : null,
      needsSelection: Boolean(payload.needsSelection),
      message: typeof payload.message === "string" ? payload.message : undefined,
    };
  } catch {
    return getAgentVpnStatus();
  }
}

export async function listAgentVpnConnections(): Promise<AgentVpnConnections> {
  const reachable = await checkAgentHealth();
  if (!reachable) {
    return {
      available: false,
      selectedConnectionName: null,
      connections: [],
      message: "Agente VPN não detectado neste computador.",
    };
  }

  try {
    const response = await fetchWithTimeout(
      `${AGENT_BASE_URL}/v1/vpn/connections`,
      undefined,
      AGENT_REQUEST_TIMEOUT_MS,
    );
    if (!response.ok) {
      return { available: false, selectedConnectionName: null, connections: [], message: "Não foi possível listar VPNs." };
    }
    const payload = (await response.json()) as {
      available?: unknown;
      selectedConnectionName?: unknown;
      connections?: unknown;
      message?: unknown;
    };
    return {
      available: Boolean(payload.available),
      selectedConnectionName:
        typeof payload.selectedConnectionName === "string" && payload.selectedConnectionName
          ? payload.selectedConnectionName
          : null,
      connections: Array.isArray(payload.connections)
        ? payload.connections.filter((item): item is string => typeof item === "string" && item.length > 0)
        : [],
      message: typeof payload.message === "string" ? payload.message : undefined,
    };
  } catch {
    return {
      available: false,
      selectedConnectionName: null,
      connections: [],
      message: "Agente VPN não detectado neste computador.",
    };
  }
}

export async function setAgentVpnConnection(connectionName: string): Promise<AgentVpnStatus> {
  try {
    const response = await fetchWithTimeout(`${AGENT_BASE_URL}/v1/vpn/config`, {
      method: "POST",
      body: JSON.stringify({ connectionName }),
    });
    if (!response.ok) {
      return getAgentVpnStatus();
    }
    return getAgentVpnStatus();
  } catch {
    return getAgentVpnStatus();
  }
}
