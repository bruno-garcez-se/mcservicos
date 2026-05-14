import axios from "axios";
import { getAgentVpnStatus, setAgentVpnEnabled, type AgentVpnStatus } from "./vpnAgentApi";

const VPN_STATUS_SYNC_EVENT = "mc:vpn-status-sync";
const VPN_FEEDBACK_EVENT = "mc:vpn-feedback";
const WRITE_METHODS = new Set(["post", "put", "patch", "delete"]);
const VPN_SKIP_PATH_PREFIXES = [
  "/auth/login",
  "/auth/refresh",
  "/auth/logout",
  "/api/servidores-importados/seconsig/test-run",
  "/api/servidores-importados/seconsig/test-sync",
];

let ensureVpnOffPromise: Promise<void> | null = null;

export const http = axios.create({
  baseURL: import.meta.env.VITE_API_URL ?? "/api",
  withCredentials: true,
});

type VpnStatusSyncEventDetail =
  | { kind: "status"; status: AgentVpnStatus }
  | { kind: "transition"; connected: boolean };

type VpnFeedbackEventDetail = {
  tone: "info" | "error";
  message: string;
};

function emitVpnStatusSync(status: AgentVpnStatus): void {
  if (typeof window === "undefined") return;
  const detail: VpnStatusSyncEventDetail = { kind: "status", status };
  window.dispatchEvent(new CustomEvent<VpnStatusSyncEventDetail>(VPN_STATUS_SYNC_EVENT, { detail }));
}

function emitVpnTransitionSync(connected: boolean): void {
  if (typeof window === "undefined") return;
  const detail: VpnStatusSyncEventDetail = { kind: "transition", connected };
  window.dispatchEvent(new CustomEvent<VpnStatusSyncEventDetail>(VPN_STATUS_SYNC_EVENT, { detail }));
}

function emitVpnFeedback(tone: "info" | "error", message: string): void {
  if (typeof window === "undefined" || !message.trim()) return;
  const detail: VpnFeedbackEventDetail = { tone, message };
  window.dispatchEvent(new CustomEvent<VpnFeedbackEventDetail>(VPN_FEEDBACK_EVENT, { detail }));
}

function shouldHandleAutoVpn(method?: string, requestUrl?: string): boolean {
  if (!method || !WRITE_METHODS.has(method.toLowerCase())) return false;
  const normalizedUrl = (requestUrl ?? "").toLowerCase();
  return !VPN_SKIP_PATH_PREFIXES.some((prefix) => normalizedUrl.startsWith(prefix));
}

async function ensureVpnOffBeforeWrite(): Promise<void> {
  const currentStatus = await getAgentVpnStatus();
  emitVpnStatusSync(currentStatus);
  if (!currentStatus.agentReachable || !currentStatus.connected) return;
  if (!currentStatus.available || !currentStatus.configured || currentStatus.needsSelection || !currentStatus.connectionExists) {
    emitVpnFeedback(
      "error",
      currentStatus.message || "Não foi possível preparar a VPN para salvar alterações.",
    );
    throw new Error(currentStatus.message || "Não foi possível preparar a VPN para salvar alterações.");
  }

  emitVpnTransitionSync(false);
  const updatedStatus = await setAgentVpnEnabled(false);
  emitVpnStatusSync(updatedStatus);
  if (updatedStatus.connected) {
    emitVpnFeedback(
      "error",
      updatedStatus.message || "Não foi possível desligar a VPN automaticamente para salvar alterações.",
    );
    throw new Error(updatedStatus.message || "Não foi possível desligar a VPN para concluir a operação.");
  }
}

http.interceptors.request.use(async (config) => {
  if (!shouldHandleAutoVpn(config.method, config.url)) {
    return config;
  }

  if (!ensureVpnOffPromise) {
    ensureVpnOffPromise = ensureVpnOffBeforeWrite().finally(() => {
      ensureVpnOffPromise = null;
    });
  }
  await ensureVpnOffPromise;
  return config;
});

export function setAuthToken(token: string | null): void {
  if (!token) {
    delete http.defaults.headers.common.Authorization;
    return;
  }
  http.defaults.headers.common.Authorization = `Bearer ${token}`;
}
