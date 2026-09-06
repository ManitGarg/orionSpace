import React, { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { HOME_ROUTE, useAuth } from "../../state/AuthContext";
import type { Role } from "../../api/types";

interface LoginPageProps {
  role: Role;
}

const COPY: Record<Role, { title: string; idLabel: string; button: string; blurb: string }> = {
  OPERATOR: {
    title: "Operator Access",
    idLabel: "Operator ID or Email",
    button: "SIGN IN AS OPERATOR",
    blurb: "Conjunction analysis, maneuver simulation, and proposal submission.",
  },
  AUTHORITY: {
    title: "Authority Access",
    idLabel: "Authority ID or Email",
    button: "SIGN IN AS AUTHORITY",
    blurb: "Review of submitted proposals, risk calculations and mission impact.",
  },
};

export function LoginPage({ role }: LoginPageProps) {
  const { signIn } = useAuth();
  const navigate = useNavigate();
  const location = useLocation() as { state?: { from?: string } };

  const [id, setId] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const copy = COPY[role];

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const user = await signIn(id, password, role);
      // Only honour a "return to" path if it is one this role can actually use;
      // otherwise land on the role's own home.
      const from = location.state?.from;
      navigate(from ?? HOME_ROUTE[user.role], { replace: true });
    } catch (err: any) {
      setError(err?.message?.includes("invalid credentials") ? "Invalid credentials for this role." : String(err?.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <span className="dot" />
          ORION
        </div>
        <div className="auth-subtitle">Secure Mission Operations</div>

        <div className="auth-section-label">{copy.title}</div>
        <p className="auth-blurb">{copy.blurb}</p>

        <div className="form-row">
          <label htmlFor="orion-id">{copy.idLabel}</label>
          <input
            id="orion-id"
            autoFocus
            autoComplete="username"
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder={role === "OPERATOR" ? "operator@orion.demo" : "authority@orion.demo"}
          />
        </div>

        <div className="form-row">
          <label htmlFor="orion-password">Password</label>
          <input
            id="orion-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {error && <div className="auth-error">{error}</div>}

        <button type="submit" className="auth-submit" disabled={busy || !id || !password}>
          {busy ? "Signing in…" : copy.button}
        </button>

        <Link to="/login" className="auth-back">
          ← Back to Role Selection
        </Link>
      </form>
    </div>
  );
}
