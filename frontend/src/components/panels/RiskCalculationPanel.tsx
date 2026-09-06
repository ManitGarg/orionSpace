import React from "react";
import type { ConjunctionDto, RiskClassification } from "../../api/types";
import { DemoBadge } from "../common/RiskBadge";
import { formatPc, formatDuration } from "../../lib/orbit";

function classColor(c: RiskClassification): string {
  switch (c) {
    case "CRITICAL":
      return "var(--risk-critical)";
    case "HIGH":
      return "var(--risk-high)";
    case "MEDIUM":
      return "var(--risk-moderate)";
    default:
      return "var(--good)";
  }
}

/** Compact scientific rendering, e.g. 2.4 × 10⁻⁴ */
function sci(value: number, digits = 2): string {
  if (value === 0) return "0";
  const exp = Math.floor(Math.log10(Math.abs(value)));
  const mantissa = value / Math.pow(10, exp);
  const supers: Record<string, string> = {
    "-": "⁻", "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴",
    "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  };
  const expStr = String(exp).split("").map((ch) => supers[ch] ?? ch).join("");
  return `${mantissa.toFixed(digits)} × 10${expStr}`;
}

function ClassificationLine({ classification, score }: { classification: RiskClassification; score: number }) {
  return (
    <div className="calc-result">
      <div style={{ fontSize: 10, letterSpacing: 1, color: "var(--text-low)", textTransform: "uppercase" }}>
        Overall Risk Score
      </div>
      <div className="score" style={{ color: classColor(classification) }}>
        {score >= 0.001 ? score.toFixed(4) : sci(score, 2)}
      </div>
      <div style={{ marginTop: 6, fontSize: 10, letterSpacing: 1, color: "var(--text-low)", textTransform: "uppercase" }}>
        Risk Classification
      </div>
      <div style={{ fontWeight: 700, letterSpacing: 1, color: classColor(classification) }}>{classification}</div>
    </div>
  );
}

/**
 * The primary risk display: the worked calculation, not a bare label. Every
 * number here comes from the server's risk model (`risk.ts`) — the same
 * computation that drives the safety gate — so what the operator reads is
 * what the system decided on.
 */
export function RiskCalculationPanel({
  conjunction,
  clockSec,
  title = "RISK CALCULATION",
  compact = false,
}: {
  conjunction: ConjunctionDto;
  /** current simulation time, to express TCA as a countdown */
  clockSec?: number;
  title?: string;
  compact?: boolean;
}) {
  const s = conjunction.scoring;
  const timeToTca = clockSec != null ? conjunction.tcaOffsetSec - clockSec : null;

  return (
    <div>
      {!compact && (
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{ fontSize: 12.5, letterSpacing: 0.8, color: "var(--text-mid)", textTransform: "uppercase" }}>
            {title}
          </span>
          <DemoBadge />
        </div>
      )}

      <div className="calc-block">
        {timeToTca != null && (
          <div className="calc-line">
            <span className="sym">Time to Closest Approach</span>
            <span className="val">TCA = {formatDuration(timeToTca)}</span>
          </div>
        )}
        <div className="calc-line">
          <span className="sym">Miss Distance</span>
          <span className="val">d = {conjunction.missDistanceKm.toFixed(2)} km</span>
        </div>
        <div className="calc-line">
          <span className="sym">Relative Velocity</span>
          <span className="val">v_rel = {conjunction.relativeVelocityKms.toFixed(2)} km/s</span>
        </div>
        <div className="calc-line">
          <span className="sym">Encounter Altitude</span>
          <span className="val">h = {conjunction.altitudeKm.toFixed(0)} km</span>
        </div>
        <div className="calc-line">
          <span className="sym">Estimated Collision Probability</span>
          <span className="val">Pc = {formatPc(conjunction.collisionProbability)}</span>
        </div>
        <div className="calc-line">
          <span className="sym">Consequence Factor</span>
          <span className="val">C = {s.consequenceFactor}</span>
        </div>

        <div className="calc-formula">
          <div>
            <span className="eq">R = Pc × C</span>
          </div>
          <div style={{ color: "var(--text-mid)" }}>
            R = {sci(s.pc, 1)} × {s.consequenceFactor}
          </div>
          <div>
            R = <span className="eq">{s.riskScore >= 0.001 ? s.riskScore.toFixed(4) : sci(s.riskScore, 2)}</span>
          </div>
        </div>

        <ClassificationLine classification={s.classification} score={s.riskScore} />

        <div className="calc-note">
          The risk classification is derived from the calculated risk score, rather than being shown as an
          unexplained label. C combines{" "}
          {s.consequenceBreakdown.map((b, i) => (
            <span key={b.label}>
              {i > 0 ? ", " : ""}
              {b.label.toLowerCase()} ({b.value})
            </span>
          ))}
          .
        </div>
      </div>
    </div>
  );
}

/** Side-by-side before/after comparison with the resulting risk reduction. */
export function RiskComparison({
  before,
  after,
}: {
  before: ConjunctionDto;
  after: ConjunctionDto;
}) {
  const bs = before.scoring;
  const as = after.scoring;
  const reductionPct = bs.riskScore > 0 ? ((bs.riskScore - as.riskScore) / bs.riskScore) * 100 : 0;

  const Column = ({
    label,
    c,
    kind,
  }: {
    label: string;
    c: ConjunctionDto;
    kind: "before" | "after";
  }) => (
    <div className={`calc-block ${kind}`}>
      <div className="calc-title">{label}</div>
      <div className="calc-line">
        <span className="sym">Miss Distance</span>
        <span className="val">{c.missDistanceKm.toFixed(2)} km</span>
      </div>
      <div className="calc-line">
        <span className="sym">Relative Velocity</span>
        <span className="val">{c.relativeVelocityKms.toFixed(2)} km/s</span>
      </div>
      <div className="calc-line">
        <span className="sym">Pc</span>
        <span className="val">{formatPc(c.collisionProbability)}</span>
      </div>
      <div className="calc-line">
        <span className="sym">C</span>
        <span className="val">{c.scoring.consequenceFactor}</span>
      </div>
      <div className="calc-formula" style={{ fontSize: 12 }}>
        R = {sci(c.scoring.pc, 1)} × {c.scoring.consequenceFactor}
      </div>
      <div className={`calc-result ${kind}`}>
        <div style={{ fontSize: 10, letterSpacing: 1, color: "var(--text-low)", textTransform: "uppercase" }}>
          Risk Score
        </div>
        <div className="score">
          {c.scoring.riskScore >= 0.001 ? c.scoring.riskScore.toFixed(4) : sci(c.scoring.riskScore, 2)}
        </div>
        <div style={{ marginTop: 4, fontWeight: 700, letterSpacing: 1, color: classColor(c.scoring.classification) }}>
          {c.scoring.classification}
        </div>
      </div>
    </div>
  );

  return (
    <div>
      <div className="stat-compare">
        <Column label="Before Maneuver" c={before} kind="before" />
        <Column label="After Maneuver" c={after} kind="after" />
      </div>
      <div className="reduction-banner">
        <span className="pct">{reductionPct >= 99.99 ? ">99.99" : reductionPct.toFixed(2)}%</span>
        <span className="lbl">Risk Reduction</span>
        <span style={{ marginLeft: "auto", color: "var(--text-low)", fontSize: 11.5, fontFamily: "var(--mono)" }}>
          {bs.classification} → {as.classification}
        </span>
      </div>
    </div>
  );
}
