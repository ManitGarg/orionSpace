import type {
  AuthUser,
  ConjunctionCurrentResponse,
  LoginResponse,
  ManeuverInput,
  ManeuverSimulateResponse,
  MissionTask,
  NearbyResponse,
  Proposal,
  Role,
  ScenarioResponse,
  TrajectoryResponse,
} from "./types";

const BASE = import.meta.env.VITE_API_URL ?? "/api";
const TOKEN_STORAGE_KEY = "orion.auth.token";

/** Distinguishes "log in" (401) from "your role cannot do this" (403) at the call site. */
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

let authToken: string | null = readStoredToken();

function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    // private mode / blocked storage — session simply won't survive a reload
    return null;
  }
}

export function setAuthToken(token: string | null): void {
  authToken = token;
  try {
    if (token) window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    else window.localStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    /* non-fatal */
  }
}

export function getAuthToken(): string | null {
  return authToken;
}

/** Called when the server rejects our token, so the app can bounce to login. */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null): void {
  onUnauthorized = fn;
}

function authHeaders(): Record<string, string> {
  return authToken ? { Authorization: `Bearer ${authToken}` } : {};
}

async function handle<T>(res: Response, path: string, isLogin = false): Promise<T> {
  // A 401 from the login endpoint means "those credentials are wrong", not
  // "your session expired" — don't clear state or bounce the user for it.
  if (res.status === 401 && !isLogin) {
    // The in-memory session store is cleared whenever the server restarts, so
    // a previously valid token can start coming back 401 mid-session.
    setAuthToken(null);
    onUnauthorized?.();
    throw new ApiError(401, "Your session has expired. Please sign in again.");
  }
  if (!res.ok) {
    let detail = `${res.status}`;
    try {
      const body = await res.json();
      detail = body?.detail ?? body?.error ?? detail;
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(res.status, `${path}: ${detail}`);
  }
  return res.json() as Promise<T>;
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${BASE}${path}`, { headers: authHeaders() });
  return handle<T>(res, `GET ${path}`);
}

async function postJson<T>(path: string, body?: unknown, isLogin = false): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify(body ?? {}),
  });
  return handle<T>(res, `POST ${path}`, isLogin);
}

export const api = {
  // auth
  login: (id: string, password: string, role: Role) =>
    postJson<LoginResponse>("/auth/login", { id, password, role }, true),
  me: () => getJson<{ user: AuthUser; permissions: string[] }>("/auth/me"),
  logout: () => postJson<{ ok: boolean }>("/auth/logout"),

  // analysis
  scenario: () => getJson<ScenarioResponse>("/scenario"),
  trajectory: (objectId: string, startSec: number, endSec: number, stepSec = 60) =>
    getJson<TrajectoryResponse>(
      `/trajectory/${encodeURIComponent(objectId)}?startSec=${startSec}&endSec=${endSec}&stepSec=${stepSec}`
    ),
  nearby: (atSec: number) => getJson<NearbyResponse>(`/nearby?atSec=${atSec}`),
  conjunctionCurrent: () => getJson<ConjunctionCurrentResponse>("/conjunction/current"),

  // tasking
  activeTask: () => getJson<{ task: MissionTask; disclaimer: string }>("/tasking/active"),

  // operator workflow
  simulateManeuver: (input: ManeuverInput) =>
    postJson<ManeuverSimulateResponse>("/maneuver/simulate", input),
  createProposal: (operator: string, maneuverInput: ManeuverInput) =>
    postJson<Proposal>("/proposals", { operator, maneuverInput }),

  // shared / authority workflow
  listProposals: () => getJson<Proposal[]>("/proposals"),
  getProposal: (id: string) => getJson<Proposal>(`/proposals/${id}`),
  decideProposal: (id: string, decision: "APPROVE" | "REQUEST_REVISION" | "REJECT", note?: string) =>
    postJson<Proposal>(`/proposals/${id}/decision`, { decision, note }),
  verifyProposal: (id: string) => postJson<Proposal>(`/proposals/${id}/verify`, {}),
};
