import React, { useMemo } from "react";
import type { ConjunctionDto } from "../../api/types";
import { DemoBadge, riskColorHex } from "../common/RiskBadge";
import { formatPc } from "../../lib/orbit";

/**
 * B-plane (encounter plane) projection: the plane normal to the relative
 * velocity vector at TCA. In this view the encounter reduces to a 2D
 * geometry problem — the miss vector, the combined covariance ellipse, and
 * the hard-body "collision safety region" disk. If the safety disk overlaps
 * the high-probability part of the covariance ellipse, the encounter is
 * risky; that is exactly what this view is meant to make legible.
 */
export function BPlaneView({ conjunction, label }: { conjunction: ConjunctionDto; label: string }) {
  const SIZE = 520;
  const CENTER = SIZE / 2;

  const { sigmaX, sigmaY, scale, bR, bT, hbrKm } = useMemo(() => {
    const sx = Math.sqrt(conjunction.combinedCovariance.sxx);
    const sy = Math.sqrt(conjunction.combinedCovariance.syy);
    const extentKm = Math.max(3 * sx, 3 * sy, Math.abs(conjunction.bplane.bR), Math.abs(conjunction.bplane.bT)) * 1.5;
    return {
      sigmaX: sx,
      sigmaY: sy,
      scale: (SIZE * 0.4) / Math.max(extentKm, 1e-6),
      bR: conjunction.bplane.bR,
      bT: conjunction.bplane.bT,
      hbrKm: conjunction.hbrKm,
    };
  }, [conjunction]);

  const toX = (km: number) => CENTER + km * scale;
  const toY = (km: number) => CENTER - km * scale;

  const riskColor = riskColorHex(conjunction.risk);
  const overlaps = Math.hypot(bR, bT) < 3 * Math.max(sigmaX, sigmaY);

  return (
    <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center", gap: 24, padding: 20 }}>
      <svg width={SIZE} height={SIZE} style={{ background: "var(--bg-1)", border: "1px solid var(--border)", borderRadius: 8 }}>
        {/* grid */}
        {[-3, -2, -1, 1, 2, 3].map((n) => (
          <g key={n}>
            <line x1={toX(n * sigmaX)} y1={0} x2={toX(n * sigmaX)} y2={SIZE} stroke="#1a212e" strokeWidth={1} />
            <line x1={0} y1={toY(n * sigmaY)} x2={SIZE} y2={toY(n * sigmaY)} stroke="#1a212e" strokeWidth={1} />
          </g>
        ))}

        {/* axes */}
        <line x1={CENTER} y1={20} x2={CENTER} y2={SIZE - 20} stroke="#3a4457" strokeWidth={1.5} />
        <line x1={20} y1={CENTER} x2={SIZE - 20} y2={CENTER} stroke="#3a4457" strokeWidth={1.5} />
        <text x={CENTER + 8} y={28} fill="#a6b2c6" fontSize={11} fontFamily="monospace">B-T</text>
        <text x={SIZE - 40} y={CENTER - 8} fill="#a6b2c6" fontSize={11} fontFamily="monospace">B-R</text>

        {/* covariance ellipses at 1σ, 2σ, 3σ — the uncertainty boundary */}
        {[1, 2, 3].map((n) => (
          <ellipse
            key={n}
            cx={CENTER}
            cy={CENTER}
            rx={sigmaX * n * scale}
            ry={sigmaY * n * scale}
            fill={n === 1 ? `${riskColor}22` : "none"}
            stroke={riskColor}
            strokeOpacity={0.7 - n * 0.15}
            strokeWidth={1.5}
            strokeDasharray={n === 3 ? "5 4" : undefined}
          />
        ))}
        <text x={CENTER + sigmaX * 3 * scale + 6} y={CENTER - 4} fill={riskColor} fontSize={10} fontFamily="monospace">3σ</text>

        {/* nominal encounter point (center of uncertainty = predicted secondary offset origin) */}
        <circle cx={CENTER} cy={CENTER} r={3.5} fill="#e7edf6" />
        <text x={CENTER + 8} y={CENTER + 14} fill="#6b7688" fontSize={10} fontFamily="monospace">nominal</text>

        {/* miss vector from nominal encounter point to the primary's position in the B-plane */}
        <line x1={CENTER} y1={CENTER} x2={toX(bR)} y2={toY(bT)} stroke="#4fa8ff" strokeWidth={2} markerEnd="url(#arrow)" />
        <defs>
          <marker id="arrow" markerWidth="8" markerHeight="8" refX="6" refY="3" orient="auto">
            <path d="M0,0 L0,6 L7,3 z" fill="#4fa8ff" />
          </marker>
        </defs>

        {/* collision safety region: hard-body radius disk around the primary */}
        <circle cx={toX(bR)} cy={toY(bT)} r={Math.max(hbrKm * scale, 3)} fill="#4fa8ff33" stroke="#4fa8ff" strokeWidth={1.5} />
        <text x={toX(bR) + 10} y={toY(bT) - 8} fill="#4fa8ff" fontSize={10} fontFamily="monospace">
          TCA · {conjunction.missDistanceKm.toFixed(2)} km
        </text>
      </svg>

      <div style={{ width: 240 }}>
        <div className="panel">
          <div className="panel-title">
            B-PLANE — {label}
            <DemoBadge />
          </div>
          <div className="kv-row"><span className="k">B·R</span><span className="v">{bR.toFixed(3)} km</span></div>
          <div className="kv-row"><span className="k">B·T</span><span className="v">{bT.toFixed(3)} km</span></div>
          <div className="kv-row"><span className="k">Miss distance</span><span className="v">{conjunction.missDistanceKm.toFixed(3)} km</span></div>
          <div className="kv-row"><span className="k">σ (B-R)</span><span className="v">{sigmaX.toFixed(3)} km</span></div>
          <div className="kv-row"><span className="k">σ (B-T)</span><span className="v">{sigmaY.toFixed(3)} km</span></div>
          <div className="kv-row"><span className="k">Combined HBR</span><span className="v">{(hbrKm * 1000).toFixed(0)} m</span></div>
          <div className="kv-row"><span className="k">Pc</span><span className="v">{formatPc(conjunction.collisionProbability)}</span></div>
          <div style={{ padding: "8px 10px 12px", color: "var(--text-mid)", fontSize: 11.5, lineHeight: 1.5 }}>
            {overlaps
              ? "The hard-body safety region falls inside the 3σ uncertainty boundary — the secondary object could plausibly be where the primary will be. This is why the encounter is flagged."
              : "The hard-body safety region lies outside the 3σ uncertainty boundary — a collision would require an error far larger than the modeled covariance."}
          </div>
        </div>
      </div>
    </div>
  );
}
