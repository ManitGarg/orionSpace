import React from "react";
import type { ConjunctionDto } from "../../api/types";
import { RiskBadge, DemoBadge } from "../common/RiskBadge";
import { formatPc } from "../../lib/orbit";

export function TCAInfoPanel({
  conjunction,
  primaryName,
  secondaryName,
  onClose,
}: {
  conjunction: ConjunctionDto;
  primaryName: string;
  secondaryName: string;
  onClose: () => void;
}) {
  return (
    <div
      className="panel"
      style={{
        position: "absolute",
        top: "50%",
        left: "50%",
        transform: "translate(-50%, -50%)",
        width: 280,
        zIndex: 40,
      }}
    >
      <div className="panel-title">
        TCA DETAILS
        <button style={{ padding: "1px 6px", fontSize: 10 }} onClick={onClose}>✕</button>
      </div>
      <div className="kv-row"><span className="k">TCA</span><span className="v">{new Date(conjunction.tcaIso).toISOString().replace("T", " ").slice(0, 19)} UTC</span></div>
      <div className="kv-row"><span className="k">Miss distance</span><span className="v">{conjunction.missDistanceKm.toFixed(3)} km</span></div>
      <div className="kv-row"><span className="k">Rel. velocity</span><span className="v">{conjunction.relativeVelocityKms.toFixed(2)} km/s</span></div>
      <div className="kv-row"><span className="k">Collision probability</span><span className="v">{formatPc(conjunction.collisionProbability)}</span></div>
      <div className="kv-row"><span className="k">Primary object</span><span className="v">{primaryName}</span></div>
      <div className="kv-row"><span className="k">Secondary object</span><span className="v">{secondaryName}</span></div>
      <div className="kv-row" style={{ alignItems: "center" }}>
        <span className="k">Risk level</span>
        <RiskBadge risk={conjunction.risk} />
      </div>
      <div style={{ padding: "8px 10px 10px" }}>
        <DemoBadge />
      </div>
    </div>
  );
}
