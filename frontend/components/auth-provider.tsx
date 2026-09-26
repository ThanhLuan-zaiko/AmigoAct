"use client";

/**
 * Session state owner.
 *
 * On mount it exchanges any stored token for the real account state via
 * `GET /api/auth/me` and seeds the `qk.me` query cache, so the dashboard's
 * membership query does not refetch. Status starts as `"loading"` on every
 * render environment — including SSR — so server and first client render
 * always agree; the effect resolves it to anonymous or authenticated.
 *
 * `signIn`/`logout` are the only write paths. `logout` also clears the query
 * cache (so no data leaks between sessions) and goes back to `/login` —
 * unless already there, to avoid bouncing a public page.
 */
import { useQueryClient } from "@tanstack/react-query";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";

import { ApiError, apiFetch, setOnUnauthorized } from "@/lib/api";
import { clearToken, getToken, saveToken } from "@/lib/auth-storage";
import { qk } from "@/lib/query-keys";
import type { AuthResponse, MeResponse, User } from "@/lib/types";

export type AuthStatus = "loading" | "anonymous" | "authenticated";

export interface AuthContextValue {
  status: AuthStatus;
  /** The signed-in account — `null` unless status is `"authenticated"`. */
  user: User | null;
  /** The verified JWT — `null` unless status is `"authenticated"`. */
  token: string | null;
  /** Store a fresh `AuthResponse` (login/register success). */
  signIn: (auth: AuthResponse) => void;
  /** Drop the session locally and return to the login page. */
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(null);

  const logout = () => {
    clearToken();
    queryClient.clear();
    setToken(null);
    setUser(null);
    setStatus("anonymous");
    if (pathname !== "/login") {
      router.replace("/login");
    }
  };

  // Any 401 on a tokened request means the session is dead — end it.
  // `logout` is referenced lazily so the hook always sees the latest closure.
  useEffect(() => {
    setOnUnauthorized(logout);
    return () => setOnUnauthorized(null);
  });

  // Bootstrap: verify a stored token and hydrate the account state.
  useEffect(() => {
    const stored = getToken();
    if (stored === null) {
      setStatus("anonymous");
      return;
    }
    let cancelled = false;
    apiFetch<MeResponse>("/api/auth/me", { token: stored })
      .then((me) => {
        if (cancelled) {
          return;
        }
        queryClient.setQueryData(qk.me, me);
        setToken(stored);
        setUser(me.user);
        setStatus("authenticated");
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        if (error instanceof ApiError && error.status === 401) {
          // Truly expired — drop it. Other failures keep the token so a
          // reload can retry once the network/server recovers.
          clearToken();
          setToken(null);
        }
        setUser(null);
        setStatus("anonymous");
      });
    return () => {
      cancelled = true;
    };
  }, [queryClient]);

  const signIn = (auth: AuthResponse) => {
    saveToken(auth.access_token);
    setToken(auth.access_token);
    setUser(auth.user);
    setStatus("authenticated");
  };

  return (
    <AuthContext.Provider value={{ status, user, token, signIn, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

/** Read the session — throws outside `<AuthProvider>`. */
export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (context === null) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
