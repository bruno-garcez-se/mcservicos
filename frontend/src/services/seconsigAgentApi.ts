const AGENT_BASE_URL = import.meta.env.VITE_VPN_AGENT_URL ?? "http://127.0.0.1:48321";
const AGENT_REQUEST_TIMEOUT_MS = 180000;

export type SeconsigAgentSyncInput = {
  baseUrl: string;
  username: string;
  password: string;
  grupoConsignante: string;
  targets: Array<{
    servidorId: number;
    nome: string;
  }>;
};

export type SeconsigAgentSyncResult = {
  items: Array<{
    servidorId: number;
    nomePesquisado: string;
    nomeEncontrado?: string;
    cpf?: string;
    margemAtual?: number;
    status?: string;
    payload?: unknown;
    found: boolean;
    exactMatch: boolean;
    error?: string;
  }>;
  stats?: {
    processados: number;
    encontrados: number;
    naoEncontrados: number;
    falhas: number;
  };
};

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

export async function runSeconsigSyncInAgent(input: SeconsigAgentSyncInput): Promise<SeconsigAgentSyncResult> {
  const response = await fetchWithTimeout(`${AGENT_BASE_URL}/v1/seconsig/sync-imported`, {
    method: "POST",
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    let message = "Agente local não conseguiu executar a sincronização SECONSIG.";
    try {
      const payload = (await response.json()) as { message?: unknown };
      if (typeof payload.message === "string" && payload.message.trim()) {
        message = payload.message;
      }
    } catch {
      // noop
    }
    throw new Error(message);
  }
  return (await response.json()) as SeconsigAgentSyncResult;
}
