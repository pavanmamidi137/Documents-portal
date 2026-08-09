"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useRouter } from "next/navigation";

import { clearTokens, getTokens, http, setTokens } from "@/lib/api";
import type { User } from "@/lib/types";

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (rollNumber: string, password: string) => Promise<User>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface LoginResponse {
  access: string;
  refresh: string;
  user: User;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const restoreSession = useCallback(async () => {
    const { access } = getTokens();
    if (!access) {
      setLoading(false);
      return;
    }
    try {
      const me = await http.get<User>("/auth/me/");
      setUser(me);
    } catch {
      clearTokens();
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // Defer so the synchronous part of session restore never cascades renders.
    const timer = setTimeout(restoreSession, 0);
    return () => clearTimeout(timer);
  }, [restoreSession]);

  const login = useCallback(
    async (rollNumber: string, password: string) => {
      const data = await http.post<LoginResponse>("/auth/login/", {
        roll_number: rollNumber.trim(),
        password,
      });
      setTokens(data.access, data.refresh);
      setUser(data.user);
      return data.user;
    },
    []
  );

  const logout = useCallback(() => {
    // Best-effort: blacklist the refresh token server-side, then sign out locally.
    const { refresh } = getTokens();
    if (refresh) {
      http.post("/auth/logout/", { refresh }).catch(() => {
        /* token may already be expired - local logout still proceeds */
      });
    }
    clearTokens();
    setUser(null);
    // Land on the public home page (it shows the login button) rather than
    // dumping users straight onto the login form.
    router.replace("/");
  }, [router]);

  const refreshUser = useCallback(async () => {
    try {
      const me = await http.get<User>("/auth/me/");
      setUser(me);
    } catch {
      /* session likely expired */
    }
  }, []);

  const value = useMemo(
    () => ({ user, loading, login, logout, refreshUser }),
    [user, loading, login, logout, refreshUser]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
