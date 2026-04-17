import { FormEvent, useEffect, useRef, useState } from "react";
import { useAuth } from "./contexts/AuthContext";
import { changePassword } from "./services/authApi";
import { LoginPage } from "./pages/LoginPage";
import { SenhasPage } from "./pages/SenhasPage";
import { UsersPage } from "./pages/UsersPage";

type Tab = "inicio" | "senhas" | "usuarios";

export default function App() {
  const { user, loading, signOut } = useAuth();
  const [tab, setTab] = useState<Tab>("senhas");
  const [isUserMenuOpen, setIsUserMenuOpen] = useState(false);
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmNewPassword, setConfirmNewPassword] = useState("");
  const [passwordMessage, setPasswordMessage] = useState("");
  const menuRef = useRef<HTMLDivElement | null>(null);
  const isAdmin = user?.role === "admin";
  const showInicio = isAdmin;
  const roleLabel = user?.role === "admin" ? "Administrador" : "Usuario";
  const userInitial = user?.name?.trim()?.charAt(0)?.toUpperCase() ?? "U";

  useEffect(() => {
    if (!showInicio && tab === "inicio") {
      setTab("senhas");
    }
  }, [showInicio, tab]);

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
      setPasswordMessage("A confirmacao da nova senha nao confere.");
      return;
    }
    try {
      await changePassword(currentPassword, newPassword);
      setPasswordMessage("Senha alterada com sucesso.");
      setCurrentPassword("");
      setNewPassword("");
      setConfirmNewPassword("");
    } catch {
      setPasswordMessage("Nao foi possivel alterar a senha.");
    }
  };

  if (loading) return <p className="screen-center">Carregando sessao...</p>;
  if (!user) return <LoginPage />;

  return (
    <div className="layout">
      <header className="topbar">
        <strong>MC Servicos - Portal interno</strong>
        <nav>
          {showInicio ? (
            <button
              type="button"
              onClick={() => setTab("inicio")}
              className={`nav-tab ${tab === "inicio" ? "active" : ""}`}
            >
              Inicio
            </button>
          ) : null}
          <button
            type="button"
            onClick={() => setTab("senhas")}
            className={`nav-tab ${tab === "senhas" ? "active" : ""}`}
          >
            Senhas
          </button>
        </nav>
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
                  <span className="menu-item-icon">👥</span>
                  <span>Usuarios</span>
                </button>
              ) : null}
              <button className="user-menu-item" type="button" onClick={openPasswordModal}>
                <span className="menu-item-icon">🔐</span>
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
                <span className="menu-item-icon">↪</span>
                <span>Sair</span>
              </button>
            </div>
          ) : null}
        </div>
      </header>

      <main>
        {tab === "inicio" && showInicio ? (
          <section className="card">
            <h2>Inicio</h2>
            <p>Espaco reservado para os demais modulos do seu sistema.</p>
          </section>
        ) : null}
        {tab === "senhas" ? <SenhasPage /> : null}
        {tab === "usuarios" && isAdmin ? <UsersPage /> : null}
      </main>

      {isPasswordModalOpen ? (
        <div className="modal-backdrop" onClick={() => setIsPasswordModalOpen(false)}>
          <section className="card modal-card" onClick={(event) => event.stopPropagation()}>
            <div className="section-header-row">
              <h2>Alterar senha</h2>
              <button type="button" onClick={() => setIsPasswordModalOpen(false)}>
                Fechar
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
            {passwordMessage ? <p>{passwordMessage}</p> : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
