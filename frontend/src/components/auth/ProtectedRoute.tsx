import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { HOME_ROUTE, LOGIN_ROUTE, useAuth } from "../../state/AuthContext";
import type { Role } from "../../api/types";

interface ProtectedRouteProps {
  children: React.ReactNode;
  /** Roles allowed here. Omit to allow any signed-in user. */
  allow?: Role[];
}

/**
 * Route guard with three outcomes:
 *  - not signed in  → the login page for the role this route belongs to
 *  - signed in, wrong role → that user's own home (never a dead end, and never
 *    a login prompt for a session that is perfectly valid)
 *  - signed in, allowed → render
 */
export function ProtectedRoute({ children, allow }: ProtectedRouteProps) {
  const { user, initializing } = useAuth();
  const location = useLocation();

  if (initializing) {
    return <div className="loading-screen">Restoring session…</div>;
  }

  if (!user) {
    const target = allow && allow.length === 1 ? LOGIN_ROUTE[allow[0]] : "/login";
    return <Navigate to={target} replace state={{ from: location.pathname }} />;
  }

  if (allow && !allow.includes(user.role)) {
    return <Navigate to={HOME_ROUTE[user.role]} replace />;
  }

  return <>{children}</>;
}
