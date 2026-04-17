import { FormEvent, useEffect, useState } from "react";
import { Group, ManagedUser } from "../types";
import { listGroups } from "../services/passwordsApi";
import { createUser, deleteUser, listUsers, updateUser } from "../services/usersApi";

type UserForm = {
  id?: number;
  name: string;
  email: string;
  password: string;
  role: "admin" | "employee";
  active: boolean;
  groupIds: number[];
};

const emptyForm: UserForm = {
  name: "",
  email: "",
  password: "",
  role: "employee",
  active: true,
  groupIds: [],
};

export function UsersPage() {
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
  const [form, setForm] = useState<UserForm>(emptyForm);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const groupNameById = new Map(groups.map((group) => [group.id, group.name]));
  const roleLabel = (role: "admin" | "employee") =>
    role === "admin" ? "Administrador" : "Usuario";
  const selectedUser = form.id ? users.find((user) => user.id === form.id) : undefined;

  async function loadData() {
    setLoading(true);
    try {
      const [usersData, groupsData] = await Promise.all([listUsers(), listGroups()]);
      setUsers(usersData);
      setGroups(groupsData);
    } catch {
      setMessage("Falha ao carregar usuarios.");
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
        });
        setMessage("Usuario atualizado.");
      } else {
        await createUser({
          name: form.name,
          email: form.email,
          password: form.password,
          role: form.role,
          active: form.active,
          groupIds: form.groupIds,
        });
        setMessage("Usuario criado.");
      }
      setForm(emptyForm);
      setIsFormOpen(false);
      await loadData();
    } catch {
      setMessage("Nao foi possivel salvar o usuario.");
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
    });
    setIsFormOpen(true);
  };

  const onDelete = async () => {
    if (!form.id) return;
    const targetLabel = selectedUser
      ? `${selectedUser.name} (${selectedUser.email})`
      : `ID ${form.id}`;
    if (!confirm(`Deseja realmente excluir o usuario ${targetLabel}?`)) return;
    try {
      await deleteUser(form.id);
      setMessage("Usuario excluido.");
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
      setMessage(apiMessage ?? "Nao foi possivel excluir o usuario.");
    }
  };

  if (loading) return <p>Carregando usuarios...</p>;

  return (
    <div className="page-grid single-column">
      <section className="card">
        <div className="section-header-row">
          <h2>Usuarios cadastrados</h2>
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
        </div>
        <table>
          <thead>
            <tr>
              <th>Nome</th>
              <th>Email</th>
              <th>Perfil</th>
              <th>Status</th>
              <th>Grupos</th>
              <th>Acoes</th>
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
                  <button type="button" onClick={() => onEdit(user)}>
                    Editar
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {isFormOpen ? (
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
              <h2>{form.id ? "Editar usuario" : "Novo usuario"}</h2>
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
            {form.id ? (
              <p className="section-subtitle">
                Usuario selecionado para edicao:{" "}
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
                      role: e.target.value as "admin" | "employee",
                    }))
                  }
                >
                  <option value="employee">Usuario</option>
                  <option value="admin">Administrador</option>
                </select>
              </label>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={form.active}
                  onChange={(e) => setForm((prev) => ({ ...prev, active: e.target.checked }))}
                />
                Usuario ativo
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

              <div className="row">
                <button type="submit">{form.id ? "Salvar" : "Criar usuario"}</button>
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
                  <button type="button" className="danger-button" onClick={() => void onDelete()}>
                    Excluir usuario
                  </button>
                ) : null}
              </div>
            </form>
            {message ? <p>{message}</p> : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
