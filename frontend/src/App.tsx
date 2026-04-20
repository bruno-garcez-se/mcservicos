import { FormEvent, Suspense, lazy, useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "./contexts/AuthContext";
import { changePassword } from "./services/authApi";
import {
  getAgentVpnStatus,
  listAgentVpnConnections,
  setAgentVpnConnection,
  setAgentVpnEnabled,
  VPN_AGENT_INSTALLER_URL,
  type AgentVpnConnections,
  type AgentVpnStatus,
} from "./services/vpnAgentApi";
import { LoginPage } from "./pages/LoginPage";

const SenhasPage = lazy(() => import("./pages/SenhasPage").then((module) => ({ default: module.SenhasPage })));
const UsersPage = lazy(() => import("./pages/UsersPage").then((module) => ({ default: module.UsersPage })));
const EmprestimosPage = lazy(() =>
  import("./pages/EmprestimosPage").then((module) => ({ default: module.EmprestimosPage })),
);
const TransacionalPage = lazy(() =>
  import("./pages/TransacionalPage").then((module) => ({ default: module.TransacionalPage })),
);
const ContatosPage = lazy(() =>
  import("./pages/ContatosPage").then((module) => ({ default: module.ContatosPage })),
);

type Tab = "senhas" | "transacional" | "negocial" | "contatos" | "usuarios";
const VPN_STATUS_SYNC_EVENT = "mc:vpn-status-sync";
const VPN_FEEDBACK_EVENT = "mc:vpn-feedback";

type VpnStatusSyncEventDetail =
  | { kind: "status"; status: AgentVpnStatus }
  | { kind: "transition"; connected: boolean }
  | AgentVpnStatus
  | undefined;

type VpnFeedbackEventDetail = {
  tone: "info" | "error";
  message: string;
};

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M9 4a5 5 0 1 1 3.9 8.13L11.5 13.5V15h-2v2H7.5v2H5.5v-3.67l3.87-3.87A5 5 0 0 1 9 4Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z" />
    </svg>
  );
}

function ChartIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M5 3a1 1 0 0 1 1 1v15h14a1 1 0 1 1 0 2H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Zm11 2a1 1 0 0 1 1 1v10a1 1 0 1 1-2 0V6a1 1 0 0 1 1-1Zm-4 4a1 1 0 0 1 1 1v6a1 1 0 1 1-2 0v-6a1 1 0 0 1 1-1Zm-4 3a1 1 0 0 1 1 1v3a1 1 0 1 1-2 0v-3a1 1 0 0 1 1-1Z" />
    </svg>
  );
}

function FunnelIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M3 5a1 1 0 0 1 1-1h16a1 1 0 0 1 .8 1.6L14 14.5V20a1 1 0 0 1-1.45.9l-3-1.5A1 1 0 0 1 9 18.5v-4L3.2 5.6A1 1 0 0 1 3 5Z" />
    </svg>
  );
}

function ContactsIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M7.2 3a2.2 2.2 0 0 0-2.1 2.7c1.2 5.3 5.9 10 11.2 11.2a2.2 2.2 0 0 0 2.7-2.1v-2a1.2 1.2 0 0 0-1-1.2l-2.7-.6a1.2 1.2 0 0 0-1.2.5l-.8 1.1a8.9 8.9 0 0 1-3.8-3.8l1.1-.8a1.2 1.2 0 0 0 .5-1.2L10.4 4a1.2 1.2 0 0 0-1.2-1h-2Z" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M16 11a4 4 0 1 0-2.65-7 4 4 0 0 0 0 7ZM7 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm0 2c-3.31 0-6 1.79-6 4v1h12v-1c0-2.21-2.69-4-6-4Zm9 0c-.29 0-.56.02-.83.05 1.14.8 1.83 1.9 1.83 3.2V20h7v-1c0-2.21-2.69-4-6-4Z"
      />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M17 8h-1V6a4 4 0 1 0-8 0v2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2Zm-7-2a2 2 0 1 1 4 0v2h-4V6Zm2 11a2 2 0 0 1-1-3.73V12a1 1 0 1 1 2 0v1.27A2 2 0 0 1 12 17Z"
      />
    </svg>
  );
}

function LogoutIcon() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M11 3a1 1 0 0 1 1 1v5a1 1 0 1 1-2 0V5H5v14h5v-4a1 1 0 1 1 2 0v5a1 1 0 0 1-1 1H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h6Zm6.59 5.59L21 12l-3.41 3.41a1 1 0 0 1-1.42-1.42L17.17 13H10a1 1 0 1 1 0-2h7.17l-1-1a1 1 0 0 1 1.42-1.41Z"
      />
    </svg>
  );
}

function InstallAgentIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 3a1 1 0 0 1 1 1v8.17l2.59-2.58a1 1 0 1 1 1.41 1.42l-4.3 4.3a1 1 0 0 1-1.4 0l-4.3-4.3a1 1 0 1 1 1.41-1.42L11 12.17V4a1 1 0 0 1 1-1Zm-7 14a1 1 0 0 1 1 1v1h12v-1a1 1 0 1 1 2 0v2a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1v-2a1 1 0 0 1 1-1Z"
      />
    </svg>
  );
}

export default function App() {
  const { user, loading, signOut } = useAuth();
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const saved = localStorage.getItem("portal:active-tab");
      if (saved === "senhas" || saved === "transacional" || saved === "negocial" || saved === "contatos" || saved === "usuarios") {
        return saved;
      }
    } catch {
      // Ignora erro de storage e usa padrão.
    }
    return "senhas";
  });
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const [vpnStatus, setVpnStatus] = useState<AgentVpnStatus | null>(null);
  const [vpnConnectedOptimistic, setVpnConnectedOptimistic] = useState<{
    connected: boolean;
    expiresAt: number;
  } | null>(null);
  const [vpnConnections, setVpnConnections] = useState<AgentVpnConnections | null>(null);
  const [selectedVpnName, setSelectedVpnName] = useState("");
  const [vpnBusy, setVpnBusy] = useState(false);
  const [isVpnInstallModalOpen, setIsVpnInstallModalOpen] = useState(false);
  const [isVpnConfigModalOpen, setIsVpnConfigModalOpen] = useState(false);
  const [vpnFeedbackMessage, setVpnFeedbackMessage] = useState("");
  const [vpnFeedbackTone, setVpnFeedbackTone] = useState<"info" | "error">("info");
  const [vpnFeedbackAction, setVpnFeedbackAction] = useState<"install" | null>(null);
  const vpnAutoConfigAttemptRef = useRef<string>("");
  const vpnFeedbackTimeoutRef = useRef<number | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const isAdmin = user?.role === "admin";
  const roleLabel = user?.role === "admin" ? "Administrador" : "Usuário";
  const userInitial = user?.name?.trim()?.charAt(0)?.toUpperCase() ?? "U";
  const menuVisibility = user?.menuVisibility ?? {
    senhas: true,
    transacional: true,
    negocial: true,
  };
  const canViewSenhas = isAdmin || menuVisibility.senhas;
  const canViewTransacional = isAdmin || menuVisibility.transacional;
  const canViewNegocial = isAdmin || menuVisibility.negocial;

  const loadVpnStatus = useCallback(async () => {
    const status = await getAgentVpnStatus();
    setVpnStatus(status);
  }, []);

  useEffect(() => {
    if (!vpnConnectedOptimistic) return;
    if (vpnStatus?.connected === vpnConnectedOptimistic.connected) {
      setVpnConnectedOptimistic(null);
      return;
    }
    const remainingMs = vpnConnectedOptimistic.expiresAt - Date.now();
    if (remainingMs <= 0) {
      setVpnConnectedOptimistic(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setVpnConnectedOptimistic((current) => {
        if (!current) return null;
        if (Date.now() >= current.expiresAt) return null;
        return current;
      });
    }, remainingMs);
    return () => window.clearTimeout(timer);
  }, [vpnStatus, vpnConnectedOptimistic]);

  const loadVpnConnections = useCallback(async () => {
    const data = await listAgentVpnConnections();
    setVpnConnections(data);
    if (data.selectedConnectionName) {
      setSelectedVpnName(data.selectedConnectionName);
      return;
    }
    if (!selectedVpnName && data.connections.length > 0) {
      setSelectedVpnName(data.connections[0]);
    }
  }, [selectedVpnName]);

  useEffect(() => {
    const tabAllowed =
      tab === "contatos" ||
      tab === "usuarios" ||
      (tab === "senhas" && canViewSenhas) ||
      (tab === "transacional" && canViewTransacional) ||
      (tab === "negocial" && canViewNegocial);
    if (isAdmin && tabAllowed) return;
    if (!isAdmin && tab === "usuarios") {
      if (canViewSenhas) setTab("senhas");
      else if (canViewTransacional) setTab("transacional");
      else if (canViewNegocial) setTab("negocial");
      else setTab("contatos");
      return;
    }
    if (!tabAllowed) {
      if (canViewSenhas) setTab("senhas");
      else if (canViewTransacional) setTab("transacional");
      else if (canViewNegocial) setTab("negocial");
      else setTab("contatos");
    }
  }, [isAdmin, tab, canViewSenhas, canViewTransacional, canViewNegocial]);

  useEffect(() => {
    const onClickOutside = (event: MouseEvent) => {
      if (!menuRef.current) return;
      if (!menuRef.current.contains(event.target as Node)) {
        setIsUserMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onClickOutside);
    return () => window.removeEventListener("mousedown", onClickOutside);
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("portal:active-tab", tab);
    } catch {
      // Ignora erro de storage para não bloquear a navegação.
    }
  }, [tab]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    const loadCurrent = async () => {
      if (!active) return;
      await Promise.all([loadVpnStatus(), loadVpnConnections()]);
    };
    void loadCurrent();
    const timer = window.setInterval(() => {
      void loadCurrent();
    }, 15000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [user, loadVpnStatus, loadVpnConnections]);

  useEffect(() => {
    const onExternalVpnStatusSync = (event: Event) => {
      const customEvent = event as CustomEvent<VpnStatusSyncEventDetail>;
      const detail = customEvent.detail;
      if (!detail) {
        void loadVpnStatus();
        return;
      }
      if (typeof detail === "object" && "kind" in detail) {
        if (detail.kind === "transition") {
          setVpnConnectedOptimistic({
            connected: detail.connected,
            expiresAt: Date.now() + 6500,
          });
          return;
        }
        if (detail.kind === "status") {
          setVpnStatus(detail.status);
          return;
        }
      }
      if (typeof detail === "object") {
        setVpnStatus(detail as AgentVpnStatus);
        return;
      }
    };

    window.addEventListener(VPN_STATUS_SYNC_EVENT, onExternalVpnStatusSync as EventListener);
    return () => window.removeEventListener(VPN_STATUS_SYNC_EVENT, onExternalVpnStatusSync as EventListener);
  }, [loadVpnStatus]);

  useEffect(() => {
    const onExternalVpnFeedback = (event: Event) => {
      const customEvent = event as CustomEvent<VpnFeedbackEventDetail | undefined>;
      const detail = customEvent.detail;
      if (!detail?.message?.trim()) return;
      setVpnFeedbackTone(detail.tone === "error" ? "error" : "info");
      setVpnFeedbackAction(null);
      setVpnFeedbackMessage(detail.message);
    };
    window.addEventListener(VPN_FEEDBACK_EVENT, onExternalVpnFeedback as EventListener);
    return () => window.removeEventListener(VPN_FEEDBACK_EVENT, onExternalVpnFeedback as EventListener);
  }, []);

  const openPasswordModal = () => {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmNewPassword("");
    setPasswordMessage("");
    setIsUserMenuOpen(false);
    setIsPasswordModalOpen(true);
  };

  const onSubmitPasswordChange = async (event: FormEvent) => {
    event.preventDefault();
    setPasswordMessage("");
    if (newPassword !== confirmNewPassword) {
      setPasswordMessage("A confirmação da nova senha não confere.");
      return;
    }
    try {
      await changePassword(currentPassword, newPassword);
      setPasswordMessage("Senha alterada com sucesso.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
    } catch {
      setPasswordMessage("Não foi possível alterar a senha.");
    }
  };
  const passwordMessageTone: "success" | "error" | "warning" = (() => {
    const text = passwordMessage.trim().toLowerCase();
    if (!text) return "warning";
    if (text.includes("não foi possível") || text.includes("falha") || text.includes("erro")) return "error";
    if (text.includes("sucesso")) return "success";
    return "warning";
  })();
  const passwordMessageLabel =
    passwordMessageTone === "success" ? "Sucesso" : passwordMessageTone === "error" ? "Erro" : "Aviso";

  const vpnConnected = vpnConnectedOptimistic?.connected ?? Boolean(vpnStatus?.connected);
  const vpnTransitionInProgress = Boolean(
    vpnConnectedOptimistic && vpnStatus?.connected !== vpnConnectedOptimistic.connected,
  );
  const vpnAgentReachable = Boolean(vpnStatus?.agentReachable);
  const vpnNeedsSelection = Boolean(vpnStatus?.needsSelection);
  const vpnCanToggle = Boolean(vpnStatus?.available && !vpnNeedsSelection);
  const vpnLooksWithoutAgent =
    !vpnAgentReachable ||
    (!vpnStatus?.available && !vpnStatus?.configured && !vpnStatus?.connectionExists && !vpnConnected);
  const vpnTooltip = vpnTransitionInProgress
    ? vpnConnected
      ? "Ligando VPN..."
      : "Desligando VPN..."
    : vpnStatus?.message ??
      (vpnLooksWithoutAgent
      ? "Agente VPN não instalado. Clique para instalar."
      : vpnNeedsSelection
        ? "Selecione a VPN deste computador para habilitar o controle."
        : vpnCanToggle
      ? vpnConnected
        ? "VPN ligada"
        : "VPN desligada"
      : "Controle de VPN indisponível neste ambiente.");
  const vpnInlineStatusLabel = vpnTransitionInProgress ? (vpnConnected ? "ligando..." : "desligando...") : "";

  const openInstallAgentFlow = () => {
    setVpnFeedbackTone("info");
    setVpnFeedbackMessage("Agente VPN não instalado. Instale o agente para habilitar o ligar/desligar.");
    setVpnFeedbackAction("install");
    setIsVpnInstallModalOpen(true);
  };

  const tryResolveSingleVpnSelection = async (): Promise<boolean> => {
    const data = await listAgentVpnConnections();
    setVpnConnections(data);

    const selectedName =
      data.selectedConnectionName && data.connections.includes(data.selectedConnectionName)
        ? data.selectedConnectionName
        : data.connections.length === 1
          ? data.connections[0]
          : "";

    if (!selectedName) {
      return false;
    }

    setSelectedVpnName(selectedName);
    const next = await setAgentVpnConnection(selectedName);
    setVpnStatus(next);
    await loadVpnConnections();
    setIsVpnConfigModalOpen(false);
    return !next.needsSelection && next.connectionExists;
  };

  const onToggleVpn = async () => {
    let currentStatus = vpnStatus ?? (await getAgentVpnStatus());
    setVpnStatus(currentStatus);

    if (currentStatus.needsSelection) {
      const autoResolved = await tryResolveSingleVpnSelection();
      if (autoResolved) {
        currentStatus = await getAgentVpnStatus();
        setVpnStatus(currentStatus);
      }
    }

    const canToggleNow = Boolean(currentStatus.available && !currentStatus.needsSelection);
    const looksWithoutAgentNow =
      !currentStatus.agentReachable ||
      (!currentStatus.available &&
        !currentStatus.configured &&
        !currentStatus.connectionExists &&
        !currentStatus.connected);
    const shouldEnable = !currentStatus.connected;

    if (!canToggleNow) {
      if (currentStatus.needsSelection) {
        setVpnFeedbackTone("info");
        setVpnFeedbackMessage("Selecione uma conexão VPN para habilitar o controle pelo sistema.");
        setVpnFeedbackAction(null);
        setIsVpnConfigModalOpen(true);
        await loadVpnConnections();
        return;
      }
      openInstallAgentFlow();
      return;
    }
    if (looksWithoutAgentNow) {
      openInstallAgentFlow();
      return;
    }
    if (!currentStatus.agentReachable) {
      setVpnFeedbackTone("info");
      setVpnFeedbackMessage("Agente VPN não instalado. Instale o agente para habilitar o ligar/desligar.");
      setVpnFeedbackAction("install");
      setIsVpnInstallModalOpen(true);
      return;
    }
    setVpnConnectedOptimistic({
      connected: shouldEnable,
      expiresAt: Date.now() + 6500,
    });
    setVpnBusy(true);
    try {
      const next = await setAgentVpnEnabled(shouldEnable);
      setVpnStatus(next);
      const nextLooksWithoutAgent =
        !next.agentReachable ||
        (!next.available && !next.configured && !next.connectionExists && !next.connected);
      if (nextLooksWithoutAgent) {
        openInstallAgentFlow();
        return;
      }
      if (shouldEnable && !next.connected) {
        setVpnFeedbackTone("error");
        setVpnFeedbackAction(null);
        setVpnFeedbackMessage(next.message ?? "Não foi possível ligar a VPN. Verifique a conexão do Windows.");
        return;
      }
      if (!shouldEnable && next.connected) {
        setVpnFeedbackTone("error");
        setVpnFeedbackAction(null);
        setVpnFeedbackMessage(next.message ?? "Não foi possível desligar a VPN neste momento. Tente novamente.");
        return;
      }
    } finally {
      setVpnBusy(false);
      await loadVpnStatus();
    }
  };

  const onVpnBadgeInteract = async (intentToggle: boolean) => {
    let currentStatus = vpnStatus ?? (await getAgentVpnStatus());
    setVpnStatus(currentStatus);

    if (currentStatus.needsSelection) {
      const autoResolved = await tryResolveSingleVpnSelection();
      if (autoResolved) {
        currentStatus = await getAgentVpnStatus();
        setVpnStatus(currentStatus);
      }
    }

    const canToggleNow = Boolean(currentStatus.available && !currentStatus.needsSelection);
    const looksWithoutAgentNow =
      !currentStatus.agentReachable ||
      (!currentStatus.available &&
        !currentStatus.configured &&
        !currentStatus.connectionExists &&
        !currentStatus.connected);

    if (!canToggleNow) {
      if (currentStatus.needsSelection) {
        setVpnFeedbackTone("info");
        setVpnFeedbackMessage("Selecione uma conexão VPN para habilitar o controle pelo sistema.");
        setVpnFeedbackAction(null);
        setIsVpnConfigModalOpen(true);
        await loadVpnConnections();
        return;
      }
      openInstallAgentFlow();
      return;
    }
    if (looksWithoutAgentNow) {
      openInstallAgentFlow();
      return;
    }
    if (!intentToggle) return;
    await onToggleVpn();
  };

  const onInstallVpnAgent = () => {
    window.open(VPN_AGENT_INSTALLER_URL, "_blank", "noopener,noreferrer");
    setVpnFeedbackTone("info");
    setVpnFeedbackMessage("Download do instalador iniciado.");
    setVpnFeedbackAction(null);
    setIsVpnInstallModalOpen(false);
    setIsVpnConfigModalOpen(false);
  };

  useEffect(() => {
    if (vpnFeedbackTimeoutRef.current) {
      window.clearTimeout(vpnFeedbackTimeoutRef.current);
      vpnFeedbackTimeoutRef.current = null;
    }
    if (!vpnFeedbackMessage) {
      setVpnFeedbackAction(null);
      return;
    }
    vpnFeedbackTimeoutRef.current = window.setTimeout(() => {
      setVpnFeedbackMessage("");
      setVpnFeedbackAction(null);
      vpnFeedbackTimeoutRef.current = null;
    }, 4500);
    return () => {
      if (vpnFeedbackTimeoutRef.current) {
        window.clearTimeout(vpnFeedbackTimeoutRef.current);
        vpnFeedbackTimeoutRef.current = null;
      }
    };
  }, [vpnFeedbackMessage]);

  const onSaveVpnSelection = async () => {
    if (!selectedVpnName.trim()) return;
    setVpnBusy(true);
    try {
      const next = await setAgentVpnConnection(selectedVpnName.trim());
      setVpnStatus(next);
      await loadVpnConnections();
      setIsVpnConfigModalOpen(false);
    } finally {
      setVpnBusy(false);
      await loadVpnStatus();
    }
  };

  useEffect(() => {
    if (!vpnStatus?.agentReachable || !vpnStatus.needsSelection || vpnBusy) return;
    const availableConnections = vpnConnections?.connections ?? [];
    if (availableConnections.length !== 1) return;

    const singleConnection = availableConnections[0];
    if (!singleConnection) return;
    if (vpnAutoConfigAttemptRef.current === singleConnection) return;

    vpnAutoConfigAttemptRef.current = singleConnection;
    setSelectedVpnName(singleConnection);

    const applySingleConnection = async () => {
      setVpnBusy(true);
      try {
        const next = await setAgentVpnConnection(singleConnection);
        setVpnStatus(next);
        await loadVpnConnections();
        setIsVpnConfigModalOpen(false);
      } finally {
        setVpnBusy(false);
        await loadVpnStatus();
      }
    };

    void applySingleConnection();
  }, [vpnStatus, vpnConnections, vpnBusy, loadVpnConnections, loadVpnStatus]);

  if (loading) return <p className="screen-center">Carregando sessão...</p>;
  if (!user) return <LoginPage />;

  return (
    <div className="layout">
      <header className="topbar">
        <strong className="topbar-brand" aria-label="Portal MC Serviços">
          <img src="/logo-topbar-mc.png" alt="Portal MC Serviços" />
        </strong>
        <nav>
          {canViewSenhas ? (
            <button
              type="button"
              onClick={() => setTab("senhas")}
              className={`nav-tab ${tab === "senhas" ? "active" : ""}`}
            >
              <span className="nav-tab-icon-label">
                <KeyIcon />
                <span>Senhas</span>
              </span>
            </button>
          ) : null}
          {canViewTransacional ? (
            <button
              type="button"
              onClick={() => setTab("transacional")}
              className={`nav-tab ${tab === "transacional" ? "active" : ""}`}
            >
              <span className="nav-tab-icon-label">
                <ChartIcon />
                <span>Transacional</span>
              </span>
            </button>
          ) : null}
          {canViewNegocial ? (
            <button
              type="button"
              onClick={() => setTab("negocial")}
              className={`nav-tab ${tab === "negocial" ? "active" : ""}`}
            >
              <span className="nav-tab-icon-label">
                <FunnelIcon />
                <span>Negocial</span>
              </span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setTab("contatos")}
            className={`nav-tab ${tab === "contatos" ? "active" : ""}`}
          >
            <span className="nav-tab-icon-label">
              <ContactsIcon />
              <span>Contatos</span>
            </span>
          </button>
        </nav>
        <div className="topbar-right">
          <div
          className={`vpn-badge ${!vpnCanToggle ? "is-clickable" : ""}`}
            title={vpnTooltip}
          onMouseDown={() => {
            if (!vpnCanToggle) {
              void onVpnBadgeInteract(false);
            }
          }}
          onClick={() => {
            void onVpnBadgeInteract(false);
          }}
          >
            <span
              className={`vpn-status-dot ${vpnConnected ? "is-on" : "is-off"} ${!vpnCanToggle ? "is-disabled" : ""}`}
              aria-hidden="true"
            />
            <span className="vpn-badge-title">VPN</span>
            <button
              type="button"
              className={`vpn-switch ${vpnConnected ? "is-on" : "is-off"} ${!vpnCanToggle ? "is-disabled" : ""}`}
              role="switch"
              aria-checked={vpnConnected}
              aria-label={vpnConnected ? "Desligar VPN" : "Ligar VPN"}
              aria-disabled={!vpnCanToggle}
              disabled={false}
              onMouseDown={(event) => {
                event.stopPropagation();
                if (!vpnCanToggle) {
                  void onVpnBadgeInteract(true);
                }
              }}
              onClick={(event) => {
                event.stopPropagation();
                void onVpnBadgeInteract(true);
              }}
            >
              <span className="vpn-switch-knob" />
            </button>
            <span
              className={`vpn-inline-status ${vpnConnected ? "is-on" : "is-off"} ${vpnInlineStatusLabel ? "is-visible" : ""}`}
              aria-live="polite"
            >
              {vpnInlineStatusLabel || "ligando..."}
            </span>
          </div>
          <div className="user-actions" ref={menuRef}>
          <button
            type="button"
            className={`user-menu-trigger ${isUserMenuOpen ? "is-open" : ""}`}
            onClick={() => setIsUserMenuOpen((prev) => !prev)}
            aria-expanded={isUserMenuOpen}
          >
            <span className="user-avatar">{userInitial}</span>
            <span className="user-menu-text">
              <strong>{user.name}</strong>
              <small>{roleLabel}</small>
            </span>
            <span className="user-menu-caret">▾</span>
          </button>
            {isUserMenuOpen ? (
              <div className="user-menu-dropdown">
                {isAdmin ? (
                  <button
                    className="user-menu-item"
                    type="button"
                    onClick={() => {
                      setTab("usuarios");
                      setIsUserMenuOpen(false);
                    }}
                  >
                    <span className="menu-item-icon" aria-hidden="true">
                      <UsersIcon />
                    </span>
                    <span>Usuários</span>
                  </button>
                ) : null}
                <button className="user-menu-item" type="button" onClick={openPasswordModal}>
                  <span className="menu-item-icon" aria-hidden="true">
                    <LockIcon />
                  </span>
                  <span>Alterar senha</span>
                </button>
                <button
                  className="user-menu-item"
                  type="button"
                  onClick={() => {
                    setIsUserMenuOpen(false);
                    void signOut();
                  }}
                >
                  <span className="menu-item-icon" aria-hidden="true">
                    <LogoutIcon />
                  </span>
                  <span>Sair</span>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      <main>
        <Suspense fallback={<p className="screen-center">Carregando módulo...</p>}>
          {tab === "senhas" && canViewSenhas ? <SenhasPage /> : null}
          {tab === "transacional" && canViewTransacional ? <TransacionalPage /> : null}
          {tab === "negocial" && canViewNegocial ? <EmprestimosPage /> : null}
          {tab === "contatos" ? <ContatosPage /> : null}
          {tab === "usuarios" && isAdmin ? <UsersPage /> : null}
        </Suspense>
      </main>

      {isPasswordModalOpen ? (
        <div className="modal-backdrop">
          <section className="card modal-card modal-card-compact" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-row">
              <h2>Alterar senha</h2>
              <button type="button" onClick={() => setIsPasswordModalOpen(false)}>
                X
              </button>
            </div>
            <form onSubmit={onSubmitPasswordChange} className="form-stack">
              <label>
                Senha atual
                <input
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                />
              </label>
              <label>
                Nova senha
                <input
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                />
              </label>
              <label>
                Confirmar nova senha
                <input
                  type="password"
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  required
                />
              </label>
              <div className="row">
                <button type="submit">Salvar senha</button>
                <button type="button" onClick={() => setIsPasswordModalOpen(false)}>
                  Cancelar
                </button>
              </div>
            </form>
            {passwordMessage ? <p>{`${passwordMessageLabel}: ${passwordMessage}`}</p> : null}
          </section>
        </div>
      ) : null}
      {isVpnInstallModalOpen ? (
        <div className="modal-backdrop">
          <section className="card modal-card modal-card-compact" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-row">
              <h2>Instalar agente VPN</h2>
              <button type="button" onClick={() => setIsVpnInstallModalOpen(false)}>
                X
              </button>
            </div>
            <p className="section-subtitle">
              Para controlar a VPN pelo sistema, é necessário instalar o agente local no Windows.
            </p>
            <div className="modal-actions">
              <button type="button" onClick={() => setIsVpnInstallModalOpen(false)}>
                Agora não
              </button>
              <button type="button" className="primary-button" onClick={onInstallVpnAgent}>
                Instalar agora
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {isVpnConfigModalOpen ? (
        <div className="modal-backdrop">
          <section className="card modal-card modal-card-compact" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-row">
              <h2>Selecionar VPN deste computador</h2>
              <button type="button" onClick={() => setIsVpnConfigModalOpen(false)}>
                X
              </button>
            </div>
            <p className="section-subtitle">
              Escolha a conexão VPN disponível no Windows para o agente controlar o ligar/desligar.
            </p>
            <label>
              Conexão VPN
              <select
                value={selectedVpnName}
                onChange={(event) => setSelectedVpnName(event.target.value)}
                disabled={vpnBusy}
              >
                <option value="">Selecione...</option>
                {(vpnConnections?.connections ?? []).map((name) => (
                  <option key={`vpn-connection-${name}`} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            {vpnConnections?.connections.length === 0 ? (
              <p className="error-text">
                Nenhuma conexão VPN foi encontrada no Windows. Crie a VPN primeiro nas configurações do sistema.
              </p>
            ) : null}
            <div className="modal-actions">
              <button type="button" onClick={() => setIsVpnConfigModalOpen(false)} disabled={vpnBusy}>
                Cancelar
              </button>
              <button
                type="button"
                className="primary-button"
                onClick={() => void onSaveVpnSelection()}
                disabled={vpnBusy || !selectedVpnName.trim()}
              >
                {vpnBusy ? "Salvando..." : "Salvar seleção"}
              </button>
            </div>
          </section>
        </div>
      ) : null}
      {vpnFeedbackMessage ? (
        <div className={`floating-feedback floating-feedback-${vpnFeedbackTone}`}>
          <span>{`${vpnFeedbackTone === "error" ? "Erro" : "Aviso"}: ${vpnFeedbackMessage}`}</span>
          <div className="vpn-feedback-actions">
            {vpnFeedbackAction === "install" ? (
              <button type="button" className="vpn-feedback-install-button" onClick={onInstallVpnAgent}>
                <InstallAgentIcon />
                <span>Instalar agora</span>
              </button>
            ) : null}
            <button
              type="button"
              className="vpn-feedback-close-button"
              onClick={() => {
                setVpnFeedbackMessage("");
                setVpnFeedbackAction(null);
              }}
            >
              X
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
