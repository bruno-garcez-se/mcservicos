import { FormEvent, useEffect, useMemo, useState } from "react";
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

type FormState = {
  id?: number;
  systemName: string;
  linkUrl: string;
  groupIds: number[];
  extraFields: FormExtraField[];
};

type FormExtraField = ExtraField & {
  clientId: string;
};

const emptyForm: FormState = {
  systemName: "",
  linkUrl: "",
  groupIds: [],
  extraFields: [],
};

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
  const [isFormOpen, setIsFormOpen] = useState(false);

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
    const normalizeFieldName = (name: string) =>
      name
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^a-z0-9]/g, "");
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
        setLoadError("Nao foi possivel carregar credenciais agora. Tente novamente.");
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

  const onCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopyInfo("Campo copiado.");
      window.setTimeout(() => setCopyInfo(""), 1500);
    } catch {
      setCopyInfo("Nao foi possivel copiar.");
      window.setTimeout(() => setCopyInfo(""), 2000);
    }
  };

  const getNavigableUrl = (rawUrl: string): string => {
    const value = rawUrl.trim();
    if (!value) return "";
    if (/^https?:\/\//i.test(value)) return value;
    return `https://${value}`;
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
        <p className="error-text">{loadError}</p>
      </div>
    );
  }

  return (
    <div className="page-grid single-column">
      <section className="card">
        <div className="section-header-row">
          <h2>Senhas</h2>
          {isAdmin ? (
            <button
              type="button"
              className="primary-button"
              onClick={() => {
                setMessage("");
                setForm(emptyForm);
                setIsFormOpen(true);
              }}
            >
              NOVO
            </button>
          ) : null}
        </div>
        <p className="section-subtitle">Atualização automática.</p>
        <div className="credential-list">
          {credentials.map((cred) => {
            const displayFields = buildDisplayFields(cred);
            return (
              <article key={cred.id} className="credential-card">
                <div className="credential-header">
                  <h3>{cred.systemName || "Sistema sem nome"}</h3>
                  <small className="credential-updated-at">
                    Ultima atualizacao: {new Date(cred.updatedAt).toLocaleString("pt-BR")}
                  </small>
                </div>

                {displayFields.length === 0 ? (
                  <p className="muted-text">Sem campos cadastrados.</p>
                ) : (
                  <div className="credential-fields">
                    {cred.linkUrl?.trim() ? (
                      <div className="credential-field-item">
                        <div className="field-label">LINK:</div>
                        <button
                          type="button"
                          className="field-value field-value-link"
                          title="Abrir link em nova aba"
                          onClick={() =>
                            window.open(getNavigableUrl(cred.linkUrl), "_blank", "noopener,noreferrer")
                          }
                        >
                          {cred.linkUrl}
                        </button>
                        <span />
                      </div>
                    ) : null}
                    {displayFields.map((field, index) => (
                      <div key={`${cred.id}-${field.name}-${index}`} className="credential-field-item">
                        <div className="field-label">{field.name || "Sem nome"}</div>
                        <div className="field-value">{field.value || "-"}</div>
                        <button
                          type="button"
                          className="icon-copy-button"
                          title="Copiar campo"
                          onClick={() => void onCopy(field.value || "")}
                        >
                          📋
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {isAdmin ? (
                  <div className="row">
                    <button type="button" onClick={() => onEdit(cred)}>
                      Editar
                    </button>
                    <button type="button" onClick={() => void onDelete(cred.id)}>
                      Excluir
                    </button>
                  </div>
                ) : null}
              </article>
            );
          })}
        </div>
        {copyInfo ? <p className="copy-feedback">{copyInfo}</p> : null}
      </section>

      {isAdmin && isFormOpen ? (
        <div
          className="modal-backdrop"
          onClick={() => {
            setForm(emptyForm);
            setIsFormOpen(false);
            setMessage("");
          }}
        >
          <section className="card modal-card" onClick={(event) => event.stopPropagation()}>
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
                Fechar
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
                      className="danger-button"
                      onClick={() =>
                        setForm((prev) => ({
                          ...prev,
                          extraFields: prev.extraFields.filter((_, idx) => idx !== index),
                        }))
                      }
                    >
                      Remover
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
                      disabled={!allowedGroupIds.includes(group.id)}
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
            {message ? <p>{message}</p> : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
