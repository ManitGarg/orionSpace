import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { api, setAuthToken, setUnauthorizedHandler, getAuthToken } from "../api/client";
import type { AuthUser, Role } from "../api/types";

interface AuthContextShape {
  user: AuthUser | null;
  permissions: string[];
  /** true until the stored token has been checked against the server */
  initializing: boolean;
  signIn: (id: string, password: string, role: Role) => Promise<AuthUser>;
  signOut: () => Promise<void>;
  can: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextShape | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const [initializing, setInitializing] = useState(true);

  // Restore a stored session on load. The server holds sessions in memory, so
  // a token that survived a page reload may no longer be valid — /auth/me is
  // the authority on that, not the presence of a token.
  useEffect(() => {
    let cancelled = false;
    if (!getAuthToken()) {
      setInitializing(false);
      return;
    }
    api
      .me()
      .then((res) => {
        if (cancelled) return;
        setUser(res.user);
        setPermissions(res.permissions);
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null);
          setPermissions([]);
        }
      })
      .finally(() => !cancelled && setInitializing(false));
    return () => {
      cancelled = true;
    };
  }, []);

  // Any 401 from anywhere in the app drops us back to signed-out state, which
  // the route guards then turn into a redirect to the right login page.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setPermissions([]);
    });
    return () => setUnauthorizedHandler(null);
  }, []);

  const signIn = useCallback(async (id: string, password: string, role: Role) => {
    const res = await api.login(id, password, role);
    setAuthToken(res.token);
    setUser(res.user);
    setPermissions(res.permissions);
    return res.user;
  }, []);

  const signOut = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* signing out locally matters more than the server round-trip */
    }
    setAuthToken(null);
    setUser(null);
    setPermissions([]);
  }, []);

  const can = useCallback((permission: string) => permissions.includes(permission), [permissions]);

  const value = useMemo(
    () => ({ user, permissions, initializing, signIn, signOut, can }),
    [user, permissions, initializing, signIn, signOut, can]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextShape {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}

/** Where each role lands after signing in. */
export const HOME_ROUTE: Record<Role, string> = {
  OPERATOR: "/conjunctions",
  AUTHORITY: "/proposals",
};

export const LOGIN_ROUTE: Record<Role, string> = {
  OPERATOR: "/login/operator",
  AUTHORITY: "/login/authority",
};
