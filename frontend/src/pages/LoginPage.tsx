import { FormEvent, useState } from "react";
import { useAuth } from "../contexts/AuthContext";

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
      setError("Nao foi possivel entrar. Verifique login e senha.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="screen-center">
      <form className="card login-card login-premium" onSubmit={onSubmit}>
        <h1>Portal MC Serviços</h1>
        <p className="login-subtitle">Acesse com sua conta corporativa.</p>

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

        {error ? <p className="error-text">{error}</p> : null}

        <button className="login-submit" type="submit" disabled={loading}>
          {loading ? "Entrando..." : "Entrar"}
        </button>
      </form>
    </div>
  );
}
