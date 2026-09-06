import React from "react";
import type { SafetyGateResult } from "../../api/types";

const BANNER_TEXT: Record<SafetyGateResult["overall"], string> = {
  CLEARED: "✅ MANEUVER CLEARED FOR AUTHORITY REVIEW",
  FLAGGED: "⚠️ MANEUVER FLAGGED",
  BLOCKED: "❌ MANEUVER BLOCKED",
};

export function SafetyGatePanel({ gate }: { gate: SafetyGateResult }) {
  return (
    <div>
      <div className={`gate-banner ${gate.overall}`}>{BANNER_TEXT[gate.overall]}</div>
      <div style={{ marginTop: 12 }}>
        {gate.checks.map((c) => (
          <div key={c.id} style={{ display: "flex", gap: 10, padding: "6px 0", alignItems: "flex-start" }}>
            <span style={{ color: c.passed ? "var(--good)" : "var(--risk-critical)", width: 14 }}>
              {c.passed ? "✓" : "✕"}
            </span>
            <div>
              <div style={{ fontWeight: 600 }}>{c.label}</div>
              <div style={{ color: "var(--text-low)", fontSize: 11.5 }}>{c.detail}</div>
            </div>
          </div>
        ))}
      </div>
      {gate.overall !== "CLEARED" && (
        <div style={{ marginTop: 10, color: "var(--text-mid)", fontSize: 12 }}>
          <strong>Reason:</strong> {gate.reason}
        </div>
      )}
    </div>
  );
}
