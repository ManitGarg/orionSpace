import React from "react";
import type { RiskLevel } from "../../api/types";

export function RiskBadge({ risk }: { risk: RiskLevel }) {
  return (
    <span className={`risk-pill risk-${risk}`}>
      <span className="swatch" />
      {risk}
    </span>
  );
}

export function DemoBadge({ label = "DEMO / SIMULATED" }: { label?: string }) {
  return <span className="demo-badge" title="Synthetic prototype data — not an operational product">{label}</span>;
}

export function riskColorHex(risk: RiskLevel): string {
  switch (risk) {
    case "CRITICAL":
      return "#e2503f";
    case "HIGH":
      return "#e0913c";
    case "MODERATE":
      return "#e3c14a";
    default:
      return "#7a8699";
  }
}
