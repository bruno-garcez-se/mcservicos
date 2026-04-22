import { FormEvent, useEffect, useState } from "react";
import { Group, ManagedUser } from "../types";
import { listGroups } from "../services/passwordsApi";
import { createUser, deleteUser, listUsers, updateUser } from "../services/usersApi";

type UserForm = {
  id?: number;
  name: string;
  email: string;
  password: string;
  role: "admin" | "employee" | "observer";
  active: boolean;
  groupIds: number[];
  menuVisibility: {
    senhas: boolean;
    transacional: boolean;
    negocial: boolean;
    contatos: boolean;
    negocialSections: {
      cadastro: boolean;
      funil: boolean;
      agenda: boolean;
      importacoes: boolean;
      comissao: boolean;
      relatorios: boolean;
    };
  };
};

const emptyForm: UserForm = {
  name: "",
  email: "",
  password: "",
  role: "employee",
  active: true,
  groupIds: [],
  menuVisibility: {
    senhas: true,
    transacional: true,
    negocial: true,
    contatos: true,
    negocialSections: {
      cadastro: true,
      funil: true,
      agenda: true,
      importacoes: true,
      comissao: true,
      relatorios: true,
    },
  },
};

function PlusIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
      <path fill="currentColor" d="M11 5a1 1 0 1 1 2 0v6h6a1 1 0 1 1 0 2h-6v6a1 1 0 1 1-2 0v-6H5a1 1 0 1 1 0-2h6V5Z" />
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

export function UsersPage() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const groupNameById = new Map(groups.map((group) => [group.id, group.name]));
  const roleLabel = (role: "admin" | "employee" | "observer") => {
    if (role === "admin") return "Administrador";
    if (role === "observer") return "Observador";
    return "Usuário";
  };
  const selectedUser = form.id ? users.find((user) => user.id === form.id) : undefined;
  const feedbackLabel = (text: string): string => {
    const normalized = text.toLowerCase();
    if (normalized.includes("falha") || normalized.includes("não foi possível") || normalized.includes("erro")) {
      return "Erro";
    }
    if (normalized.includes("criado") || normalized.includes("atualizado") || normalized.includes("excluído")) {
      return "Sucesso";
    }
    return "Aviso";
  };

  async function loadData() {
    setLoading(true);
    try {
      const [usersData, groupsData] = await Promise.all([listUsers(), listGroups()]);
      setUsers(usersData);
      setGroups(groupsData);
    } catch {
      setMessage("Falha ao carregar usuários.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage("");
    try {
      if (form.id) {
        await updateUser(form.id, {
          name: form.name,
          email: form.email,
          password: form.password.trim() || undefined,
          role: form.role,
          active: form.active,
          groupIds: form.groupIds,
          menuVisibility: form.menuVisibility,
        });
        setMessage("Usuário atualizado.");
      } else {
        await createUser({
          name: form.name,
          email: form.email,
          password: form.password,
          role: form.role,
          active: form.active,
          groupIds: form.groupIds,
          menuVisibility: form.menuVisibility,
        });
        setMessage("Usuário criado.");
      }
      setForm(emptyForm);
      setIsFormOpen(false);
      await loadData();
    } catch (error: unknown) {
      const apiMessage =
        typeof error === "object" &&
        error &&
        "response" in error &&
        typeof (error as { response?: unknown }).response === "object" &&
        (error as { response?: { data?: { message?: string } } }).response?.data?.message
          ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
          : null;
      setMessage(apiMessage ?? "Não foi possível salvar o usuário.");
    }
  };

  const onEdit = (user: ManagedUser) => {
    setMessage("");
    setForm({
      id: user.id,
      name: user.name,
      email: user.email,
      password: "",
      role: user.role,
      active: user.active,
      groupIds: user.groupIds ?? [],
      menuVisibility: user.menuVisibility ?? {
        senhas: true,
        transacional: true,
        negocial: true,
        contatos: true,
        negocialSections: {
          cadastro: true,
          funil: true,
          agenda: true,
          importacoes: true,
          comissao: true,
          relatorios: true,
        },
      },
    });
    setIsFormOpen(true);
  };

  const onDelete = async () => {
    if (!form.id) return;
    const targetLabel = selectedUser
      ? `${selectedUser.name} (${selectedUser.email})`
      : `ID ${form.id}`;
    if (!confirm(`Deseja realmente excluir o usuário ${targetLabel}?`)) return;
    try {
      await deleteUser(form.id);
      setMessage("Usuário excluído.");
      setForm(emptyForm);
      setIsFormOpen(false);
      await loadData();
    } catch (error: unknown) {
      const apiMessage =
        typeof error === "object" &&
        error &&
        "response" in error &&
        typeof (error as { response?: unknown }).response === "object" &&
        (error as { response?: { data?: { message?: string } } }).response?.data?.message
          ? (error as { response?: { data?: { message?: string } } }).response?.data?.message
          : null;
      setMessage(apiMessage ?? "Não foi possível excluir o usuário.");
    }
  };

  if (loading) return <p>Carregando usuários...</p>;

  return (
    <div className="page-grid single-column">
      <section className="card">
        <div className="section-header-row">
          <h2>Usuários cadastrados</h2>
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
        </div>
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Email</th>
              <th>Perfil</th>
              <th>Status</th>
              <th>Grupos</th>
              <th>Ações</th>
            </tr>
          </thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td>{user.name}</td>
                <td>{user.email}</td>
                <td>{roleLabel(user.role)}</td>
                <td>{user.active ? "Ativo" : "Inativo"}</td>
                <td>
                  {user.groupIds.length === 0
                    ? "-"
                    : user.groupIds
                        .map((groupId) => groupNameById.get(groupId) ?? String(groupId))
                        .join(", ")}
                </td>
                <td>
                  <button
                    type="button"
                    className="transaction-icon-button"
                    title="Editar usuário"
                    aria-label="Editar usuário"
                    onClick={() => onEdit(user)}
                  >
                    <EditIcon />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {isFormOpen ? (
        <div className="modal-backdrop">
          <section className="card modal-card modal-card-users" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-row">
              <h2>{form.id ? "Editar usuário" : "Novo usuário"}</h2>
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
            {form.id ? (
              <p className="section-subtitle">
                Usuário selecionado para edição:{" "}
                <strong>
                  {selectedUser?.name ?? form.name} ({selectedUser?.email ?? form.email})
                </strong>
              </p>
            ) : null}
            <form onSubmit={onSubmit} className="form-stack">
              <label>
                Nome
                <input
                  value={form.name}
                  onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
                  required
                />
              </label>
              <label>
                Email
                <input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((prev) => ({ ...prev, email: e.target.value }))}
                  required
                />
              </label>
              <label>
                {form.id ? "Senha (opcional para trocar)" : "Senha"}
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => setForm((prev) => ({ ...prev, password: e.target.value }))}
                  required={!form.id}
                />
              </label>
              <label>
                Perfil
                <select
                  value={form.role}
                  onChange={(e) =>
                    setForm((prev) => ({
                      ...prev,
                      role: e.target.value as "admin" | "employee" | "observer",
                    }))
                  }
                >
                  <option value="employee">Usuário</option>
                  <option value="admin">Administrador</option>
                  <option value="observer">Observador</option>
                </select>
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm((prev) => ({ ...prev, active: e.target.checked }))}
                />
                Usuário ativo
              </label>

              <fieldset>
                <legend>Grupos</legend>
                {groups.map((group) => (
                  <label key={group.id} className="checkbox">
                    <input
                      type="checkbox"
                      checked={form.groupIds.includes(group.id)}
                      onChange={(e) =>
                        setForm((prev) => {
                          const next = e.target.checked
                            ? [...prev.groupIds, group.id]
                            : prev.groupIds.filter((id) => id !== group.id);
                          return { ...prev, groupIds: next };
                        })
                      }
                    />
                    {group.name}
                  </label>
                ))}
              </fieldset>
              <fieldset>
                <legend>Menus visíveis</legend>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={form.menuVisibility.senhas}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        menuVisibility: { ...prev.menuVisibility, senhas: e.target.checked },
                      }))
                    }
                  />
                  Senhas
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={form.menuVisibility.transacional}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        menuVisibility: { ...prev.menuVisibility, transacional: e.target.checked },
                      }))
                    }
                  />
                  Transacional
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={form.menuVisibility.negocial}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        menuVisibility: { ...prev.menuVisibility, negocial: e.target.checked },
                      }))
                    }
                  />
                  Negocial
                </label>
                <label className="checkbox">
                  <input
                    type="checkbox"
                    checked={form.menuVisibility.contatos}
                    onChange={(e) =>
                      setForm((prev) => ({
                        ...prev,
                        menuVisibility: { ...prev.menuVisibility, contatos: e.target.checked },
                      }))
                    }
                  />
                  Contatos
                </label>
                <fieldset>
                  <legend>Submenus do Negocial</legend>
                  <small className="muted-text">
                    Esses controles valem quando o menu Negocial estiver visível.
                  </small>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={form.menuVisibility.negocialSections.cadastro}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          menuVisibility: {
                            ...prev.menuVisibility,
                            negocialSections: { ...prev.menuVisibility.negocialSections, cadastro: e.target.checked },
                          },
                        }))
                      }
                    />
                    Cadastro
                  </label>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={form.menuVisibility.negocialSections.funil}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          menuVisibility: {
                            ...prev.menuVisibility,
                            negocialSections: { ...prev.menuVisibility.negocialSections, funil: e.target.checked },
                          },
                        }))
                      }
                    />
                    Funil de Vendas
                  </label>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={form.menuVisibility.negocialSections.agenda}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          menuVisibility: {
                            ...prev.menuVisibility,
                            negocialSections: { ...prev.menuVisibility.negocialSections, agenda: e.target.checked },
                          },
                        }))
                      }
                    />
                    Agenda
                  </label>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={form.menuVisibility.negocialSections.importacoes}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          menuVisibility: {
                            ...prev.menuVisibility,
                            negocialSections: { ...prev.menuVisibility.negocialSections, importacoes: e.target.checked },
                          },
                        }))
                      }
                    />
                    Importações
                  </label>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={form.menuVisibility.negocialSections.comissao}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          menuVisibility: {
                            ...prev.menuVisibility,
                            negocialSections: { ...prev.menuVisibility.negocialSections, comissao: e.target.checked },
                          },
                        }))
                      }
                    />
                    Comissões
                  </label>
                  <label className="checkbox">
                    <input
                      type="checkbox"
                      checked={form.menuVisibility.negocialSections.relatorios}
                      onChange={(e) =>
                        setForm((prev) => ({
                          ...prev,
                          menuVisibility: {
                            ...prev.menuVisibility,
                            negocialSections: { ...prev.menuVisibility.negocialSections, relatorios: e.target.checked },
                          },
                        }))
                      }
                    />
                    Relatórios
                  </label>
                </fieldset>
              </fieldset>

              <div className="row">
                <button type="submit">{form.id ? "Salvar" : "Criar usuário"}</button>
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
                {form.id ? (
                  <button
                    type="button"
                    className="transaction-icon-button danger"
                    title="Excluir usuário"
                    aria-label="Excluir usuário"
                    onClick={() => void onDelete()}
                  >
                    <TrashIcon />
                  </button>
                ) : null}
              </div>
            </form>
            {message ? <p>{`${feedbackLabel(message)}: ${message}`}</p> : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
