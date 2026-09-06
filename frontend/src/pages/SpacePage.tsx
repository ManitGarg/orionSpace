import React, { useEffect, useState } from "react";
import { useAppState } from "../state/AppState";
import { api } from "../api/client";
import type { NearbyResponse } from "../api/types";
import { RiskBadge } from "../components/common/RiskBadge";
import { Link } from "react-router-dom";

export function SpacePage() {
  const { scenario, clockSec } = useAppState();
  const [nearby, setNearby] = useState<NearbyResponse | null>(null);

  useEffect(() => {
    if (!scenario) return;
    api.nearby(Math.round(clockSec)).then(setNearby).catch(() => {});
  }, [scenario, Math.round(clockSec / 30)]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="page">
      <h1>Space — Tracked Object Field</h1>
      <p className="lede">Objects tracked around the primary satellite at the current simulation time.</p>
      <div className="card">
        <h2>Objects</h2>
        {nearby?.objects.map((o) => (
          <div className="proposal-row" key={o.id}>
            <div>
              <div style={{ fontWeight: 600 }}>{o.name}</div>
              <div style={{ color: "var(--text-low)", fontSize: 11 }}>
                {o.type} · {o.distanceKm.toFixed(1)} km · Δv {o.relativeVelocityKms.toFixed(2)} km/s
              </div>
            </div>
            <RiskBadge risk={o.risk} />
          </div>
        ))}
        <Link to="/conjunctions"><button style={{ marginTop: 8 }}>View in 3D</button></Link>
      </div>
    </div>
  );
}
