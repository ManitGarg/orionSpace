import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Role-based authentication for the ORION prototype.
 *
 * Credentials live in environment variables (see .env.example) with demo
 * defaults, so nothing secret is compiled into the frontend bundle. Sessions
 * are opaque HMAC-signed tokens held in memory — appropriate for a demo, and
 * deliberately not a substitute for a real identity provider.
 */

export type Role = "OPERATOR" | "AUTHORITY";

export interface AuthUser {
  id: string;
  role: Role;
  displayName: string;
}

/**
 * Permission model. The two roles are deliberately disjoint on the decision
 * boundary: an operator may propose but never approve their own maneuver, and
 * an authority may decide but never edit the operator's maneuver parameters.
 */
export const ROLE_PERMISSIONS: Record<Role, string[]> = {
  OPERATOR: [
    "conjunction:view",
    "space:view",
    "maneuver:simulate",
    "maneuver:propose",
    "risk:view",
    "tasking:view",
    "proposal:view",
  ],
  AUTHORITY: [
    "conjunction:view",
    "space:view",
    "risk:view",
    "tasking:view",
    "proposal:view",
    "proposal:decide",
    "proposal:verify",
  ],
};

export function hasPermission(role: Role, permission: string): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

interface CredentialRecord {
  id: string;
  password: string;
  role: Role;
  displayName: string;
}

function credentials(): CredentialRecord[] {
  return [
    {
      id: (process.env.ORION_OPERATOR_ID ?? "operator@orion.demo").toLowerCase(),
      password: process.env.ORION_OPERATOR_PASSWORD ?? "ORION-OP-2026",
      role: "OPERATOR",
      displayName: process.env.ORION_OPERATOR_NAME ?? "MUJ Operations — Operator",
    },
    {
      id: (process.env.ORION_AUTHORITY_ID ?? "authority@orion.demo").toLowerCase(),
      password: process.env.ORION_AUTHORITY_PASSWORD ?? "ORION-AUTH-2026",
      role: "AUTHORITY",
      displayName: process.env.ORION_AUTHORITY_NAME ?? "National Space Authority — Reviewer",
    },
  ];
}

/** Constant-time string comparison that tolerates differing lengths. */
function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

const SESSION_SECRET = process.env.ORION_SESSION_SECRET ?? randomBytes(32).toString("hex");
const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

interface Session {
  user: AuthUser;
  expiresAt: number;
}

const sessions = new Map<string, Session>();

function signToken(sessionId: string): string {
  const mac = createHmac("sha256", SESSION_SECRET).update(sessionId).digest("hex");
  return `${sessionId}.${mac}`;
}

function verifyToken(token: string): string | null {
  const idx = token.lastIndexOf(".");
  if (idx <= 0) return null;
  const sessionId = token.slice(0, idx);
  const mac = token.slice(idx + 1);
  const expected = createHmac("sha256", SESSION_SECRET).update(sessionId).digest("hex");
  return safeEqual(mac, expected) ? sessionId : null;
}

export interface LoginResult {
  token: string;
  user: AuthUser;
  permissions: string[];
}

/**
 * Authenticate against the configured credentials. `expectedRole` is supplied
 * by the role-specific login pages: signing in through the operator page with
 * authority credentials is rejected rather than silently logging the user into
 * the wrong console.
 */
export function login(id: string, password: string, expectedRole?: Role): LoginResult | null {
  const normalized = String(id ?? "").trim().toLowerCase();
  const record = credentials().find((c) => c.id === normalized);
  if (!record) return null;
  if (!safeEqual(String(password ?? ""), record.password)) return null;
  if (expectedRole && record.role !== expectedRole) return null;

  const sessionId = randomBytes(24).toString("hex");
  const user: AuthUser = { id: record.id, role: record.role, displayName: record.displayName };
  sessions.set(sessionId, { user, expiresAt: Date.now() + SESSION_TTL_MS });
  return { token: signToken(sessionId), user, permissions: ROLE_PERMISSIONS[record.role] };
}

export function resolveSession(token: string | undefined): AuthUser | null {
  if (!token) return null;
  const sessionId = verifyToken(token);
  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  return session.user;
}

export function logout(token: string | undefined): void {
  if (!token) return;
  const sessionId = verifyToken(token);
  if (sessionId) sessions.delete(sessionId);
}
