import { FormEvent, useState } from "react";
import { useAuth } from "../contexts/AuthContext";

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true">
      <path
        fill="currentColor"
        d="M17 8h-1V6a4 4 0 1 0-8 0v2H7a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-9a2 2 0 0 0-2-2Zm-7-2a2 2 0 1 1 4 0v2h-4V6Zm2 11a2 2 0 0 1-1-3.73V12a1 1 0 1 1 2 0v1.27A2 2 0 0 1 12 17Z"
      />
    </svg>
  );
}

export function LoginPage() {
  const { signIn } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      await signIn(email, password);
    } catch {
      setError("Não foi possível entrar. Verifique login e senha.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="screen-center login-screen">
      <form className="card login-card login-premium" onSubmit={onSubmit}>
        <div className="login-header">
          <img className="login-logo" src="/login-logo-mc.png" alt="Portal MC Serviços" />
        </div>

        <label className="login-label">
          E-mail
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </label>

        <label className="login-label">
          Senha
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </label>

        {error ? <p className="error-text">{`Erro: ${error}`}</p> : null}

        <div className="login-submit-area">
          <p className="login-security-note">
            <LockIcon />
            <span>Acesso seguro ao ambiente interno</span>
          </p>
          <button className="login-submit" type="submit" disabled={loading}>
            {loading ? "Entrando..." : "Entrar"}
          </button>
        </div>
      </form>
    </div>
  );
}
