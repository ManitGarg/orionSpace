/**
 * Risk scoring: R = Pc × C.
 *
 * Collision probability alone does not express how bad a collision would be.
 * Standard risk practice multiplies probability by a consequence term, and
 * ORION does the same so the operator sees *why* an encounter is rated the way
 * it is rather than an unexplained label.
 *
 * The consequence factor C here is a transparent, deterministic function of
 * properties ORION already models — the secondary's mass class, the encounter
 * energy, and the debris-generating potential at that altitude. It is a
 * prototype heuristic on synthetic inputs, not a validated consequence model,
 * and is surfaced as DEMO / SIMULATED like everything else.
 */

export type RiskClassification = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface ConsequenceInputs {
  /** representative mass of the secondary object, kg */
  secondaryMassKg: number;
  /** relative velocity at TCA, km/s — drives collision energy */
  relativeVelocityKms: number;
  /** encounter altitude, km — debris at higher altitude persists far longer */
  altitudeKm: number;
}

export interface RiskScore {
  /** collision probability (dimensionless) */
  pc: number;
  /** consequence factor (dimensionless severity units) */
  consequenceFactor: number;
  /** R = Pc × C */
  riskScore: number;
  classification: RiskClassification;
  /** human-readable breakdown of how C was built, for the UI */
  consequenceBreakdown: Array<{ label: string; value: string }>;
}

/**
 * Collision kinetic energy scales with m·v². We express C on a scale where a
 * routine small-debris encounter lands in the low hundreds and a massive,
 * high-energy, high-altitude encounter reaches a few thousand — so that
 * R = Pc × C lands in a range an operator can read at a glance.
 */
export function consequenceFactor(inputs: ConsequenceInputs): {
  value: number;
  breakdown: Array<{ label: string; value: string }>;
} {
  const { secondaryMassKg, relativeVelocityKms, altitudeKm } = inputs;

  // collision energy in MJ: 0.5 * m * v^2, with v in m/s
  const vMs = relativeVelocityKms * 1000;
  const energyMJ = (0.5 * secondaryMassKg * vMs * vMs) / 1e6;

  // Energy term, compressed logarithmically: a 10x more energetic impact is
  // worse, but not 10x worse in mission terms — both are catastrophic to the
  // spacecraft; what changes is the debris field produced.
  const energyTerm = Math.log10(Math.max(energyMJ, 1)) * 120;

  // Orbital-persistence term: debris below ~400 km re-enters within years,
  // while debris near 800 km persists for centuries.
  const persistenceTerm = Math.min(Math.max((altitudeKm - 300) / 500, 0), 1.5) * 260;

  // Baseline consequence of losing an operational spacecraft at all.
  const assetLossTerm = 300;

  const value = Math.round(energyTerm + persistenceTerm + assetLossTerm);

  return {
    value,
    breakdown: [
      { label: "Asset loss baseline", value: assetLossTerm.toFixed(0) },
      { label: `Collision energy (${energyMJ.toFixed(0)} MJ)`, value: energyTerm.toFixed(0) },
      { label: `Debris persistence (${altitudeKm.toFixed(0)} km)`, value: persistenceTerm.toFixed(0) },
    ],
  };
}

/**
 * Classification is derived from the computed score, not asserted separately —
 * this is what lets the UI say the label follows from the number.
 */
export function classifyRiskScore(riskScore: number): RiskClassification {
  if (riskScore >= 1e-1) return "CRITICAL";
  if (riskScore >= 1e-2) return "HIGH";
  if (riskScore >= 1e-4) return "MEDIUM";
  return "LOW";
}

export function computeRiskScore(pc: number, inputs: ConsequenceInputs): RiskScore {
  const c = consequenceFactor(inputs);
  const riskScore = pc * c.value;
  return {
    pc,
    consequenceFactor: c.value,
    riskScore,
    classification: classifyRiskScore(riskScore),
    consequenceBreakdown: c.breakdown,
  };
}

/** Percentage reduction from a before-score to an after-score, clamped to [0, 100]. */
export function riskReductionPercent(before: number, after: number): number {
  if (before <= 0) return 0;
  return Math.min(100, Math.max(0, ((before - after) / before) * 100));
}
