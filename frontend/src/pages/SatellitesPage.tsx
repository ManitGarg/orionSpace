import React from "react";
import { useAppState } from "../state/AppState";
import { Link } from "react-router-dom";

export function SatellitesPage() {
  const { scenario } = useAppState();
  return (
    <div className="page">
      <h1>Satellites</h1>
      <p className="lede">Fleet view is out of scope for this prototype — ORION currently tracks a single primary spacecraft.</p>
      <div className="card">
        <h2>Fleet</h2>
        <div className="proposal-row">
          <div>
            <div style={{ fontWeight: 600 }}>{scenario?.primary.name}</div>
            <div style={{ color: "var(--text-low)", fontSize: 11 }}>{scenario?.primary.type} · Primary</div>
          </div>
          <Link to="/conjunctions"><button>View in 3D</button></Link>
        </div>
      </div>
    </div>
  );
}
