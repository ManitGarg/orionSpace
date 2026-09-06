import type { NextFunction, Request, Response } from "express";
import { AuthUser, hasPermission, resolveSession, Role } from "../lib/auth.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function tokenFrom(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) return header.slice("Bearer ".length);
  return undefined;
}

/** Populates req.user when a valid session token is present. Never rejects. */
export function attachUser(req: Request, _res: Response, next: NextFunction): void {
  req.user = resolveSession(tokenFrom(req)) ?? undefined;
  next();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "authentication required" });
    return;
  }
  next();
}

/**
 * Guard a route on a specific permission. Returns 403 (not 401) for an
 * authenticated user in the wrong role, so the frontend can distinguish
 * "log in" from "your role cannot do this".
 */
export function requirePermission(permission: string) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "authentication required" });
      return;
    }
    if (!hasPermission(req.user.role, permission)) {
      res.status(403).json({
        error: "forbidden",
        detail: `role ${req.user.role} does not hold permission ${permission}`,
      });
      return;
    }
    next();
  };
}

export function requireRole(role: Role) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "authentication required" });
      return;
    }
    if (req.user.role !== role) {
      res.status(403).json({ error: "forbidden", detail: `requires ${role} role` });
      return;
    }
    next();
  };
}
