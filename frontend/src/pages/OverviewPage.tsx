import React from "react";
import { useAppState } from "../state/AppState";
import { useAuth } from "../state/AuthContext";
import { DemoBadge } from "../components/common/RiskBadge";
import { Link } from "react-router-dom";

export function OverviewPage() {
  const { scenario } = useAppState();
  const { user } = useAuth();
  const isOperator = user?.role === "OPERATOR";
  return (
    <div className="page">
      <h1>Mission Overview</h1>
      <p className="lede">
        ORION connects conjunction risk, operator-proposed maneuvers, the safety gate and authority review into one
        workflow. This prototype focuses that workflow around a single primary satellite and one active high-risk
        conjunction. <DemoBadge />
      </p>
      <div className="card">
        <h2>Primary Satellite</h2>
        <div className="kv-row"><span className="k">Name</span><span className="v">{scenario?.primary.name}</span></div>
        <div className="kv-row"><span className="k">Tracked objects nearby</span><span className="v">{scenario ? scenario.nearby.length + 1 : "—"}</span></div>
        <div className="kv-row"><span className="k">Active conjunction</span><span className="v">{scenario?.threat.name}</span></div>
      </div>
      <div className="card">
        <h2>Workflow</h2>
        <p style={{ color: "var(--text-mid)", lineHeight: 1.7 }}>
          Conjunction → Risk Calculation → Operator Maneuver → Proposed Trajectory → Mission Impact → Task Reassignment
          → Safety Gate → Authority Review → Verification → Event Resolved.
        </p>
        <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
          <Link to="/conjunctions"><button>Open Conjunctions</button></Link>
          {isOperator && <Link to="/maneuver-lab"><button>Open Maneuver Lab</button></Link>}
          <Link to="/mission-continuity"><button>Mission Continuity</button></Link>
          <Link to="/proposals"><button>{isOperator ? "My Proposals" : "Authority Console"}</button></Link>
        </div>
      </div>
      <div className="card">
        <h2>Prototype disclaimer</h2>
        <p style={{ color: "var(--text-low)", lineHeight: 1.6, margin: 0 }}>
          ORION does not command spacecraft, execute burns, or grant official authority approval. Orbits, covariance
          and collision probabilities shown throughout this prototype are synthetic decision-support demonstrations,
          not operational collision predictions.
        </p>
      </div>
    </div>
  );
}
