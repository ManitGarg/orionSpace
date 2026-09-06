import React from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { useAppState } from "../../state/AppState";
import { useAuth } from "../../state/AuthContext";
import type { Role } from "../../api/types";

interface NavItem {
  to: string;
  label: string;
  /** omit to show for every role */
  roles?: Role[];
}

const NAV_ITEMS: NavItem[] = [
  { to: "/overview", label: "Overview" },
  { to: "/satellites", label: "Satellites" },
  { to: "/conjunctions", label: "Conjunctions" },
  { to: "/space", label: "Space" },
  { to: "/maneuver-lab", label: "Maneuver Lab", roles: ["OPERATOR"] },
  { to: "/mission-continuity", label: "Mission Continuity" },
  { to: "/proposals", label: "Proposals" },
];

const ROLE_LABEL: Record<Role, string> = {
  OPERATOR: "OPERATOR",
  AUTHORITY: "AUTHORITY",
};

export function Shell({ children }: { children: React.ReactNode }) {
  const { scenario } = useAppState();
  const { user, signOut } = useAuth();
  const navigate = useNavigate();

  const items = NAV_ITEMS.filter((item) => !item.roles || (user && item.roles.includes(user.role)));

  const handleSignOut = async () => {
    await signOut();
    navigate("/login", { replace: true });
  };

  return (
    <div className="orion-shell">
      <div className="orion-topbar">
        <div className="orion-brand">
          <span className="dot" />
          ORION
          <span className="sub">Orbital Vision — Operator-to-Authority Space Safety Layer</span>
        </div>
        <div className="orion-topbar-right">
          <span>Satellite: {scenario?.primary.name ?? "—"}</span>
          {user && (
            <>
              <span className={`role-chip role-chip-${user.role}`}>{ROLE_LABEL[user.role]}</span>
              <span style={{ color: "var(--text-low)" }}>{user.displayName}</span>
              <button style={{ padding: "3px 9px", fontSize: 11 }} onClick={handleSignOut}>
                Sign out
              </button>
            </>
          )}
        </div>
      </div>
      <div className="orion-body">
        <nav className="orion-nav">
          <div className="section-label">NAVIGATION</div>
          {items.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive ? "active" : "")}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <main className="orion-main">{children}</main>
      </div>
    </div>
  );
}
