import { Router } from "express";
import { login, logout, ROLE_PERMISSIONS, Role } from "../lib/auth.js";
import { requireAuth } from "./authMiddleware.js";

export const authRoutes = Router();

function parseRole(value: unknown): Role | undefined {
  return value === "OPERATOR" || value === "AUTHORITY" ? value : undefined;
}

authRoutes.post("/login", (req, res) => {
  const { id, password } = req.body ?? {};
  const expectedRole = parseRole(req.body?.role);
  const result = login(String(id ?? ""), String(password ?? ""), expectedRole);
  if (!result) {
    // Deliberately uniform message: do not reveal whether the id exists, or
    // whether it was the role rather than the password that did not match.
    res.status(401).json({ error: "invalid credentials for this role" });
    return;
  }
  res.json(result);
});

authRoutes.get("/me", requireAuth, (req, res) => {
  const user = req.user!;
  res.json({ user, permissions: ROLE_PERMISSIONS[user.role] });
});

authRoutes.post("/logout", (req, res) => {
  const header = req.headers.authorization;
  logout(header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined);
  res.json({ ok: true });
});
