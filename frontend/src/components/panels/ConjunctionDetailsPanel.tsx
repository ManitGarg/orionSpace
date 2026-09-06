import React from "react";
import type { ConjunctionDto } from "../../api/types";
import { RiskBadge, DemoBadge } from "../common/RiskBadge";
import { formatPc } from "../../lib/orbit";
import { useAppState } from "../../state/AppState";

export function ConjunctionDetailsPanel({
  primaryName,
  secondaryName,
  conjunction,
  afterConjunction,
}: {
  primaryName: string;
  secondaryName: string;
  conjunction: ConjunctionDto | null;
  afterConjunction: ConjunctionDto | null;
}) {
  const { trajectoryMode, requestFocus, setConjunctionFocused, conjunctionFocused } = useAppState();
  const shown = trajectoryMode === "PROPOSED" || trajectoryMode === "VERIFIED" ? afterConjunction ?? conjunction : conjunction;
  if (!shown) return null;

  return (
    <div className="panel floating-topright">
      <div className="panel-title">
        CONJUNCTION DETAILS
        <DemoBadge />
      </div>
      <div className="kv-row"><span className="k">TCA</span><span className="v">{new Date(shown.tcaIso).toISOString().replace("T", " ").slice(0, 19)} UTC</span></div>
      <div className="kv-row"><span className="k">PRIMARY</span><span className="v">{primaryName}</span></div>
      <div className="kv-row"><span className="k">SECONDARY</span><span className="v">{secondaryName}</span></div>
      <div className="kv-row"><span className="k">MISS DISTANCE</span><span className="v">{shown.missDistanceKm.toFixed(2)} km</span></div>
      <div className="kv-row"><span className="k">REL. VELOCITY</span><span className="v">{shown.relativeVelocityKms.toFixed(2)} km/s</span></div>
      <div className="kv-row"><span className="k">Pc</span><span className="v">{formatPc(shown.collisionProbability)}</span></div>
      <div className="kv-row" style={{ alignItems: "center" }}>
        <span className="k">RISK</span>
        <RiskBadge risk={shown.risk} />
      </div>
      <div style={{ display: "flex", gap: 6, padding: "8px 10px 10px" }}>
        <button
          className={conjunctionFocused ? "active" : ""}
          onClick={() => {
            setConjunctionFocused(true);
            requestFocus("TCA");
          }}
        >
          Focus Encounter
        </button>
      </div>
    </div>
  );
}
