import {
  createContext,
  ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  getMe,
  login as loginApi,
  logout as logoutApi,
  refreshToken,
} from "../services/authApi";
import { setAuthToken } from "../services/http";
import { User } from "../types";
import { connectRealtime, disconnectRealtime } from "../services/realtime";

type AuthContextValue = {
  user: User | null;
  token: string | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function bootstrap() {
      try {
        const nextToken = await refreshToken();
        setToken(nextToken);
        setAuthToken(nextToken);
        const me = await getMe();
        setUser(me);
        localStorage.setItem("portal:user", JSON.stringify(me));
        connectRealtime(nextToken);
      } catch {
        setToken(null);
        setAuthToken(null);
      } finally {
        setLoading(false);
      }
    }
    void bootstrap();
  }, []);

  const signIn = async (email: string, password: string) => {
    const data = await loginApi(email, password);
    setUser(data.user);
    setToken(data.accessToken);
    localStorage.setItem("portal:user", JSON.stringify(data.user));
    setAuthToken(data.accessToken);
    connectRealtime(data.accessToken);
  };

  const signOut = async () => {
    await logoutApi();
    setUser(null);
    setToken(null);
    localStorage.removeItem("portal:user");
    setAuthToken(null);
    disconnectRealtime();
  };

  const value = useMemo(
    () => ({
      user,
      token,
      loading,
      signIn,
      signOut,
    }),
    [user, token, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("AuthContext ausente.");
  }
  return ctx;
}
