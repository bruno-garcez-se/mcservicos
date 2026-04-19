import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "../contexts/AuthContext";
import { Credential, ExtraField, Group } from "../types";
import {
  createCredential,
  deleteCredential,
  listCredentials,
  listGroups,
  updateCredential,
} from "../services/passwordsApi";
import { connectRealtime } from "../services/realtime";
import { getAgentVpnStatus, setAgentVpnEnabled, type AgentVpnStatus } from "../services/vpnAgentApi";

type FormState = {
  id?: number;
  systemName: string;
  accessMode: "web" | "vpn";
  linkUrl: string;
  groupIds: number[];
  extraFields: FormExtraField[];
};

type FormExtraField = ExtraField & {
  clientId: string;
};

const normalizeFieldName = (name: string) =>
  name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]/g, "");

const emptyForm: FormState = {
  systemName: "",
  accessMode: "web",
  linkUrl: "",
  groupIds: [],
  extraFields: [],
};

const VPN_STATUS_SYNC_EVENT = "mc:vpn-status-sync";

function ClipboardIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M9 2a2 2 0 0 0-2 2H6a3 3 0 0 0-3 3v12a3 3 0 0 0 3 3h8a3 3 0 0 0 3-3v-1h1a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3h-1a2 2 0 0 0-2-2H9Zm0 2h6v2H9V4ZM6 6h1v2h10V6h1a1 1 0 0 1 1 1v8a1 1 0 0 1-1 1h-1V9a3 3 0 0 0-3-3H6Zm0 5h8a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1Z"
      />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M9.55 17.2 4.7 12.35l1.4-1.4 3.45 3.45 8.35-8.35 1.4 1.4-9.75 9.75Z" />
    </svg>
  );
}

function ExternalLinkIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M14 3a1 1 0 1 0 0 2h3.59l-8.3 8.29a1 1 0 1 0 1.42 1.42L19 6.41V10a1 1 0 1 0 2 0V3h-7ZM5 5a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h12a2 2 0 0 0 2-2v-6a1 1 0 1 0-2 0v6H5V7h6a1 1 0 1 0 0-2H5Z"
      />
    </svg>
  );
}

function EditIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="m3 17.25 9.81-9.81 2.75 2.75L5.75 20H3v-2.75Zm14.71-8.79-2.75-2.75 1.39-1.39a1 1 0 0 1 1.41 0l1.34 1.34a1 1 0 0 1 0 1.41l-1.39 1.39Z"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M11 5a1 1 0 1 1 2 0v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5Z" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M9 3a1 1 0 0 0-1 1v1H5a1 1 0 1 0 0 2h.7l.8 12.06A2 2 0 0 0 8.5 21h7a2 2 0 0 0 1.99-1.94L18.3 7H19a1 1 0 1 0 0-2h-3V4a1 1 0 0 0-1-1H9Zm1 2V5h4V5h-4Zm-1.3 2h6.6l-.77 11.5a.5.5 0 0 1-.5.5h-4.06a.5.5 0 0 1-.5-.5L8.7 7Zm2.3 2a1 1 0 0 0-1 1v6a1 1 0 1 0 2 0v-6a1 1 0 0 0-1-1Zm4 0a1 1 0 0 0-1 1v6a1 1 0 1 0 2 0v-6a1 1 0 0 0-1-1Z"
      />
    </svg>
  );
}

function KeyIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path
        fill="currentColor"
        d="M9 4a5 5 0 1 1 3.9 8.13L11.5 13.5V15h-2v2H7.5v2H5.5v-3.67l3.87-3.87A5 5 0 0 1 9 4Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z"
      />
    </svg>
  );
}

function BadgeVpnIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 2a5 5 0 0 0-5 5v2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5Zm-3 7V7a3 3 0 1 1 6 0v2H9Z"
      />
    </svg>
  );
}

function BadgeWebIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path
        fill="currentColor"
        d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm6.92 8h-3.05a13.1 13.1 0 0 0-1.23-4A7.03 7.03 0 0 1 18.92 11Zm-6.92 8a10.8 10.8 0 0 1-1.8-3h3.6a10.8 10.8 0 0 1-1.8 3Zm-2.36-5a11.2 11.2 0 0 1 0-4h4.72a11.2 11.2 0 0 1 0 4H9.64Zm-4.56-3h3.05c.2-1.42.62-2.78 1.23-4A7.03 7.03 0 0 0 5.08 11Zm3.05 2H5.08a7.03 7.03 0 0 0 4.28 4c-.61-1.22-1.03-2.58-1.23-4Zm6.51 4a7.03 7.03 0 0 0 4.28-4h-3.05c-.2 1.42-.62 2.78-1.23 4ZM12 5a10.8 10.8 0 0 1 1.8 3h-3.6A10.8 10.8 0 0 1 12 5Z"
      />
    </svg>
  );
}

export function SenhasPage() {
  const { token, user } = useAuth();
  const [credentials, setCredentials] = useState<Credential[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [loadError, setLoadError] = useState("");
  const [draggingExtraIndex, setDraggingExtraIndex] = useState<number | null>(null);
  const [copyInfo, setCopyInfo] = useState("");
  const [copiedRowKey, setCopiedRowKey] = useState("");
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [vpnInfo, setVpnInfo] = useState("");
  const credentialLinkWindowsRef = useRef<Record<string, Window | null>>({});

  const isAdmin = user?.role === "admin";

  const createClientField = (field?: Partial<ExtraField>): FormExtraField => ({
    clientId:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: field?.name ?? "",
    value: field?.value ?? "",
  });

  const buildDisplayFields = (cred: Credential): ExtraField[] => {
    const normalized = [...(cred.extraFields ?? [])];
    const hasLogin = normalized.some((item) => normalizeFieldName(item.name) === "login");
    const hasSenha = normalized.some((item) => normalizeFieldName(item.name) === "senha");

    const isLikelyEncryptedPayload = (value: string) => {
      const parts = value.split(":");
      return (
        parts.length === 3 &&
        parts.every((part) => part.length > 0 && /^[A-Za-z0-9+/=]+$/.test(part))
      );
    };

    if (cred.username && !hasLogin) {
      normalized.unshift({ name: "Login", value: cred.username });
    }
    if (cred.password && !hasSenha && !isLikelyEncryptedPayload(cred.password)) {
      normalized.unshift({ name: "Senha", value: cred.password });
    }
    return normalized;
  };

  useEffect(() => {
    async function loadData() {
      setLoading(true);
      setLoadError("");
      try {
        const [creds, grps] = await Promise.all([listCredentials(), listGroups()]);
        setCredentials(creds);
        setGroups(grps);
      } catch {
        setLoadError("Não foi possível carregar credenciais agora. Tente novamente.");
      } finally {
        setLoading(false);
      }
    }

    void loadData();
  }, []);

  useEffect(() => {
    if (!token) return;
    const socket = connectRealtime(token);
    socket.on("password:upsert", (updated: Credential) => {
      setCredentials((prev) => {
        const idx = prev.findIndex((item) => item.id === updated.id);
        if (idx === -1) return [...prev, updated].sort((a, b) => a.systemName.localeCompare(b.systemName));
        const next = [...prev];
        next[idx] = updated;
        return next;
      });
    });
    socket.on("password:delete", (payload: { id: number }) => {
      setCredentials((prev) => prev.filter((item) => item.id !== payload.id));
    });

    return () => {
      socket.off("password:upsert");
      socket.off("password:delete");
    };
  }, [token]);

  const allowedGroupIds = useMemo(() => {
    if (isAdmin) return groups.map((g) => g.id);
    return user?.groupIds ?? [];
  }, [groups, isAdmin, user?.groupIds]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    try {
      if (form.id) {
        const updated = await updateCredential(form.id, {
          systemName: form.systemName,
          accessMode: form.accessMode,
          linkUrl: form.linkUrl,
          username: "",
          password: "",
          groupIds: form.groupIds,
          extraFields: form.extraFields.map(({ name, value }) => ({ name, value })),
        });
        setCredentials((prev) => {
          const idx = prev.findIndex((item) => item.id === updated.id);
          if (idx === -1) {
            return [...prev, updated].sort((a, b) => a.systemName.localeCompare(b.systemName));
          }
          const next = [...prev];
          next[idx] = updated;
          return next;
        });
        setMessage("Credencial atualizada.");
      } else {
        const created = await createCredential({
          systemName: form.systemName,
          accessMode: form.accessMode,
          linkUrl: form.linkUrl,
          username: "",
          password: "",
          groupIds: form.groupIds,
          extraFields: form.extraFields.map(({ name, value }) => ({ name, value })),
        });
        setCredentials((prev) =>
          [...prev, created].sort((a, b) => a.systemName.localeCompare(b.systemName)),
        );
        setMessage("Credencial criada.");
      }
      setForm(emptyForm);
      setIsFormOpen(false);
    } catch {
      setMessage("Falha ao salvar credencial.");
    }
  };

  const onEdit = (cred: Credential) => {
    const displayFields = buildDisplayFields(cred);
    setForm({
      id: cred.id,
      systemName: cred.systemName,
      accessMode: cred.accessMode === "vpn" ? "vpn" : "web",
      linkUrl: cred.linkUrl ?? "",
      groupIds: cred.groupIds,
      extraFields: displayFields.map((field) => createClientField(field)),
    });
    setIsFormOpen(true);
  };

  const onDelete = async (id: number) => {
    if (!confirm("Deseja remover essa credencial?")) return;
    await deleteCredential(id);
    setCredentials((prev) => prev.filter((item) => item.id !== id));
  };

  const onExtraFieldDrop = (dropIndex: number) => {
    if (draggingExtraIndex === null || draggingExtraIndex === dropIndex) return;

    setForm((prev) => {
      const next = [...prev.extraFields];
      const [moved] = next.splice(draggingExtraIndex, 1);
      if (!moved) return prev;
      next.splice(dropIndex, 0, moved);
      return { ...prev, extraFields: next };
    });
    setDraggingExtraIndex(null);
  };

  const onCopy = async (value: string): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyInfo("Campo copiado.");
      window.setTimeout(() => setCopyInfo(""), 1500);
      return true;
    } catch {
      setCopyInfo("Não foi possível copiar.");
      window.setTimeout(() => setCopyInfo(""), 2000);
      return false;
    }
  };
  const onCopyRow = (
    value: string,
    rowKey: string,
    credentialContext?: { linkUrl: string; accessMode: "web" | "vpn" },
  ) => {
    if (!value.trim()) {
      setCopyInfo("Nada para copiar.");
      window.setTimeout(() => setCopyInfo(""), 1500);
      return;
    }
    void onCopy(value).then((ok) => {
      if (!ok) return;
      if (credentialContext?.linkUrl?.trim()) {
        navigateCredentialLinkIfAlreadyOpen(credentialContext.linkUrl);
        void syncVpnByAccessMode(credentialContext.accessMode).catch(() => undefined);
      }
      setCopiedRowKey(rowKey);
      window.setTimeout(() => {
        setCopiedRowKey((current) => (current === rowKey ? "" : current));
      }, 1400);
    });
  };

  const getNavigableUrl = (rawUrl: string): string => {
    const value = rawUrl.trim();
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;
    return `https://${value}`;
  };
  const getCredentialLinkTarget = (navigableUrl: string): string => {
    try {
      const parsed = new URL(navigableUrl);
      const seed = `${parsed.origin}${parsed.pathname}`
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "_")
        .replace(/^_+|_+$/g, "");
      return `credential_link_${seed.slice(0, 80) || "default"}`;
    } catch {
      return "credential_link_default";
    }
  };
  const pushVpnInfo = (text: string) => {
    if (!text.trim()) return;
    setVpnInfo(text);
    window.setTimeout(() => setVpnInfo(""), 2200);
  };
  const emitVpnStatusSync = (status: AgentVpnStatus) => {
    window.dispatchEvent(new CustomEvent<AgentVpnStatus>(VPN_STATUS_SYNC_EVENT, { detail: status }));
  };
  const syncVpnByAccessMode = async (accessMode: "web" | "vpn") => {
    const shouldEnableVpn = accessMode === "vpn";
    const currentStatus = await getAgentVpnStatus();
    emitVpnStatusSync(currentStatus);

    if (!currentStatus.agentReachable) {
      pushVpnInfo("Agente VPN não detectado neste computador.");
      return;
    }
    if (!currentStatus.configured || currentStatus.needsSelection || !currentStatus.connectionExists) {
      pushVpnInfo(currentStatus.message || "Configure a VPN no agente para automação.");
      return;
    }

    if (currentStatus.connected === shouldEnableVpn) {
      pushVpnInfo(shouldEnableVpn ? "VPN já estava ligada." : "VPN já estava desligada.");
      return;
    }

    const updatedStatus = await setAgentVpnEnabled(shouldEnableVpn);
    emitVpnStatusSync(updatedStatus);
    if (updatedStatus.connected === shouldEnableVpn) {
      pushVpnInfo(shouldEnableVpn ? "VPN ligada automaticamente." : "VPN desligada automaticamente.");
      return;
    }
    pushVpnInfo(
      updatedStatus.message ||
        (shouldEnableVpn ? "Não foi possível ligar a VPN automaticamente." : "Não foi possível desligar a VPN automaticamente."),
    );
  };
  const openCredentialLinkWithAccessMode = async (rawUrl: string, accessMode: "web" | "vpn") => {
    await syncVpnByAccessMode(accessMode);
    const navigableUrl = getNavigableUrl(rawUrl);
    if (!navigableUrl) return;
    const target = getCredentialLinkTarget(navigableUrl);
    const openedWindow = window.open(navigableUrl, target);
    if (openedWindow) {
      credentialLinkWindowsRef.current[target] = openedWindow;
    }
  };
  const navigateCredentialLinkIfAlreadyOpen = (rawUrl: string): boolean => {
    const navigableUrl = getNavigableUrl(rawUrl);
    if (!navigableUrl) return false;
    const target = getCredentialLinkTarget(navigableUrl);
    const existingWindow = credentialLinkWindowsRef.current[target];
    if (!existingWindow || existingWindow.closed) {
      return false;
    }
    try {
      existingWindow.focus();
      return true;
    } catch {
      return false;
    }
  };
  const getCredentialFieldMaskedValue = (field: ExtraField): string => {
    if (normalizeFieldName(field.name) === "senha") {
      return "●●●●●●●●";
    }
    return field.value || "-";
  };
  const feedbackLabel = (text: string): string => {
    const normalized = text.toLowerCase();
    if (normalized.includes("falha") || normalized.includes("não foi possível") || normalized.includes("erro")) {
      return "Erro";
    }
    if (
      normalized.includes("criada") ||
      normalized.includes("atualizada") ||
      normalized.includes("copiado") ||
      normalized.includes("ligada") ||
      normalized.includes("desligada")
    ) {
      return "Sucesso";
    }
    return "Aviso";
  };

  useEffect(() => {
    if (!isFormOpen) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setForm(emptyForm);
        setIsFormOpen(false);
        setMessage("");
      }
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isFormOpen]);

  if (loading) {
    return <p>Carregando credenciais...</p>;
  }

  if (loadError) {
    return (
      <div className="card">
        <p className="error-text">{`Erro: ${loadError}`}</p>
      </div>
    );
  }

  return (
    <div className="page-grid single-column">
      <section className="card">
        <div className="section-header-row">
          <h2 className="loan-title-icon-label">
            <KeyIcon />
            <span>Senhas</span>
          </h2>
          {isAdmin ? (
            <button
              type="button"
              className="transaction-top-action transaction-top-action-new"
              onClick={() => {
                setMessage("");
                setForm(emptyForm);
                setIsFormOpen(true);
              }}
            >
              <span className="button-icon-inline">
                <PlusIcon />
                <span>Novo</span>
              </span>
            </button>
          ) : null}
        </div>
        <p className="section-subtitle senhas-subtitle">Atualização automática.</p>
        <div className="credential-list">
          {credentials.map((cred) => {
            const accessMode = cred.accessMode === "vpn" ? "vpn" : "web";
            const displayFields = buildDisplayFields(cred);
            return (
              <article key={cred.id} className="credential-card">
                <span className={`credential-access-badge ${accessMode === "vpn" ? "is-vpn" : "is-web"}`}>
                  <span className="credential-access-badge-icon" aria-hidden="true">
                    {accessMode === "vpn" ? <BadgeVpnIcon /> : <BadgeWebIcon />}
                  </span>
                  {accessMode === "vpn" ? "VPN" : "WEB"}
                </span>
                <div className="credential-header">
                  <div className="credential-title-row">
                    <h3 className="credential-system-name">{cred.systemName || "Sistema sem nome"}</h3>
                    <button
                      type="button"
                      className="transaction-icon-button credential-edit-inline-button"
                      title="Editar credencial"
                      aria-label="Editar credencial"
                      onClick={() => onEdit(cred)}
                    >
                      <EditIcon />
                    </button>
                  </div>
                </div>

                {!cred.linkUrl?.trim() && displayFields.length === 0 ? (
                  <p className="muted-text">Sem campos cadastrados.</p>
                ) : (
                  <div className="credential-fields">
                    {cred.linkUrl?.trim() ? (
                      (() => {
                        return (
                      <div
                        className="credential-field-item credential-link-row"
                        role="button"
                        tabIndex={0}
                        title="Abrir link em nova aba"
                        onClick={() => void openCredentialLinkWithAccessMode(cred.linkUrl, accessMode)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            void openCredentialLinkWithAccessMode(cred.linkUrl, accessMode);
                          }
                        }}
                      >
                        <div className="field-label">LINK:</div>
                        <button
                          type="button"
                          className="field-value field-value-link"
                          title="Abrir link em nova aba"
                          onClick={(event) => {
                            event.stopPropagation();
                            void openCredentialLinkWithAccessMode(cred.linkUrl, accessMode);
                          }}
                        >
                          {cred.linkUrl}
                        </button>
                        <span className="copy-indicator" aria-hidden="true">
                          <ExternalLinkIcon />
                        </span>
                      </div>
                        );
                      })()
                    ) : null}
                    {displayFields.map((field, index) => (
                      (() => {
                        const rowKey = `${cred.id}-${field.name}-${index}`;
                        const copied = copiedRowKey === rowKey;
                        const maskedValue = getCredentialFieldMaskedValue(field);
                        const copyValue = field.value || "";
                        return (
                      <div
                        key={rowKey}
                        className={`credential-field-item credential-copyable-row ${copied ? "copied" : ""}`}
                        role="button"
                        tabIndex={0}
                        title={copied ? "Copiado!" : "Clique para copiar"}
                        onClick={() =>
                          onCopyRow(copyValue, rowKey, { linkUrl: cred.linkUrl, accessMode })
                        }
                        onKeyDown={(event) => {
                          if (event.key === "Enter" || event.key === " ") {
                            event.preventDefault();
                            onCopyRow(copyValue, rowKey, { linkUrl: cred.linkUrl, accessMode });
                          }
                        }}
                      >
                        <div className="field-label">{field.name || "Sem nome"}</div>
                        <div className="field-value">{maskedValue}</div>
                        <span className="copy-indicator" aria-hidden="true">
                          {copied ? <CheckIcon /> : <ClipboardIcon />}
                        </span>
                      </div>
                        );
                      })()
                    ))}
                  </div>
                )}

                <div className="credential-footer">
                  <small className="credential-updated-at">
                    Atualizado por {cred.updatedByName || "Sistema"} em{" "}
                    {new Date(cred.updatedAt).toLocaleString("pt-BR")}
                  </small>
                </div>

                {isAdmin ? (
                  <div className="row">
                    <button
                      type="button"
                      className="transaction-icon-button danger"
                      title="Excluir credencial"
                      aria-label="Excluir credencial"
                      onClick={() => void onDelete(cred.id)}
                    >
                      <TrashIcon />
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
        {copyInfo ? <p className="copy-feedback">{`${feedbackLabel(copyInfo)}: ${copyInfo}`}</p> : null}
        {vpnInfo ? <p className="copy-feedback">{`${feedbackLabel(vpnInfo)}: ${vpnInfo}`}</p> : null}
      </section>

      {isFormOpen ? (
        <div className="modal-backdrop">
          <section className="card modal-card modal-card-senhas" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-row">
              <h2>{form.id ? "Editar credencial" : "Nova credencial"}</h2>
              <button
                type="button"
                onClick={() => {
                  setForm(emptyForm);
                  setIsFormOpen(false);
                  setMessage("");
                }}
              >
                X
              </button>
            </div>
            <form onSubmit={onSubmit} className="form-stack">
              <label>
                Sistema
                <input
                  value={form.systemName}
                  onChange={(e) => setForm((prev) => ({ ...prev, systemName: e.target.value }))}
                />
              </label>
              <label>
                LINK:
                <input
                  placeholder="https://sistema.exemplo.com"
                  value={form.linkUrl}
                  onChange={(e) => setForm((prev) => ({ ...prev, linkUrl: e.target.value }))}
                />
              </label>
              <label>
                Tipo de acesso
                <select
                  value={form.accessMode}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      accessMode: event.target.value === "vpn" ? "vpn" : "web",
                    }))
                  }
                >
                  <option value="web">WEB</option>
                  <option value="vpn">VPN</option>
                </select>
              </label>
              <fieldset>
                <legend>Adicionar campos (arraste para ordenar)</legend>
                {form.extraFields.map((field, index) => (
                  <div
                    key={field.clientId}
                    className={`extra-field-row ${draggingExtraIndex === index ? "dragging" : ""}`}
                    draggable
                    onDragStart={() => setDraggingExtraIndex(index)}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => onExtraFieldDrop(index)}
                    onDragEnd={() => setDraggingExtraIndex(null)}
                  >
                    <span className="drag-handle" title="Arraste para reordenar">
                      :::
                    </span>
                    <input
                      placeholder="Nome do campo (ex.: CNPJ, CPF)"
                      value={field.name}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          extraFields: prev.extraFields.map((item, idx) =>
                            idx === index ? { ...item, name: e.target.value } : item,
                          ),
                        }))
                      }
                    />
                    <input
                      placeholder="Valor do campo"
                      value={field.value}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          extraFields: prev.extraFields.map((item, idx) =>
                            idx === index ? { ...item, value: e.target.value } : item,
                          ),
                        }))
                      }
                    />
                    <button
                      type="button"
                      className="transaction-icon-button danger credential-extra-remove-button"
                      title="Remover campo"
                      aria-label="Remover campo"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          extraFields: prev.extraFields.filter((_, idx) => idx !== index),
                        }))
                      }
                    >
                      <TrashIcon />
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  onClick={() =>
                    setForm((prev) => ({
                      ...prev,
                      extraFields: [...prev.extraFields, createClientField()],
                    }))
                  }
                >
                  + Adicionar campo
                </button>
              </fieldset>
              <fieldset>
                <legend>Grupos com acesso</legend>
                {groups.map((group) => (
                  <label key={group.id} className="checkbox">
                    <input
                      type="checkbox"
                      checked={form.groupIds.includes(group.id)}
                      disabled={!isAdmin || !allowedGroupIds.includes(group.id)}
                      onChange={(e) => {
                        setForm((prev) => {
                          const next = e.target.checked
                            ? [...prev.groupIds, group.id]
                            : prev.groupIds.filter((id) => id !== group.id);
                          return { ...prev, groupIds: next };
                        });
                      }}
                    />
                    {group.name}
                  </label>
                ))}
              </fieldset>
              <div className="row">
                <button type="submit">{form.id ? "Salvar" : "Criar"}</button>
                <button
                  type="button"
                  onClick={() => {
                    setForm(emptyForm);
                    setIsFormOpen(false);
                    setMessage("");
                  }}
                >
                  Cancelar
                </button>
              </div>
            </form>
            {message ? <p>{`${feedbackLabel(message)}: ${message}`}</p> : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
