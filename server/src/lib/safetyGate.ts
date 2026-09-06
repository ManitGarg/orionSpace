import { ManeuverSimulationResult } from "./maneuver.js";

export interface SafetyGateCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface SafetyGateResult {
  checks: SafetyGateCheck[];
  overall: "CLEARED" | "FLAGGED" | "BLOCKED";
  reason: string;
}

const MAX_DELTA_V_MS = 5.0; // synthetic mission Δv budget constraint per maneuver
const MIN_LEAD_TIME_SEC = 15 * 60; // burn must occur at least 15 min before TCA
const MIN_ACCEPTABLE_MISS_KM = 5.0; // secondary-screening / mission-constraint floor

export function evaluateSafetyGate(sim: ManeuverSimulationResult): SafetyGateResult {
  const checks: SafetyGateCheck[] = [];

  const riskReduced = sim.after.collisionProbability < sim.before.collisionProbability;
  checks.push({
    id: "risk_reduced",
    label: "Primary Risk Reduced",
    passed: riskReduced,
    detail: riskReduced
      ? `Pc reduced from ${sim.before.collisionProbability.toExponential(2)} to ${sim.after.collisionProbability.toExponential(2)}`
      : `Pc did not improve (before ${sim.before.collisionProbability.toExponential(2)}, after ${sim.after.collisionProbability.toExponential(2)})`,
  });

  const dvOk = sim.deltaVMagnitudeMs <= MAX_DELTA_V_MS;
  checks.push({
    id: "dv_constraint",
    label: "Δv Constraint Passed",
    passed: dvOk,
    detail: dvOk
      ? `Δv ${sim.deltaVMagnitudeMs.toFixed(3)} m/s within ${MAX_DELTA_V_MS} m/s budget`
      : `Δv ${sim.deltaVMagnitudeMs.toFixed(3)} m/s exceeds ${MAX_DELTA_V_MS} m/s budget`,
  });

  const leadTimeSec = sim.before.tcaOffsetSec - sim.burnOffsetSec;
  const timingOk = leadTimeSec >= MIN_LEAD_TIME_SEC;
  checks.push({
    id: "burn_timing",
    label: "Burn Timing Valid",
    passed: timingOk,
    detail: timingOk
      ? `Burn executes ${(leadTimeSec / 60).toFixed(0)} min before original TCA`
      : `Burn is only ${(leadTimeSec / 60).toFixed(0)} min before TCA (min ${MIN_LEAD_TIME_SEC / 60} min)`,
  });

  const secondaryOk = sim.after.missDistanceKm >= sim.before.missDistanceKm;
  checks.push({
    id: "secondary_screening",
    label: "Secondary Screening Passed",
    passed: secondaryOk,
    detail: secondaryOk
      ? "No new higher-risk conjunction introduced by proposed trajectory (DEMO/SIMULATED screening)"
      : "Proposed trajectory did not improve separation at re-screened window",
  });

  const missionOk = sim.after.missDistanceKm >= MIN_ACCEPTABLE_MISS_KM || sim.after.risk === "SAFE";
  checks.push({
    id: "mission_constraints",
    label: "Mission Constraints Passed",
    passed: missionOk,
    detail: missionOk
      ? `Post-maneuver miss distance ${sim.after.missDistanceKm.toFixed(2)} km satisfies mission floor`
      : `Post-maneuver miss distance ${sim.after.missDistanceKm.toFixed(2)} km below ${MIN_ACCEPTABLE_MISS_KM} km mission floor`,
  });

  const allPassed = checks.every((c) => c.passed);
  const criticalFailed = !dvOk || !timingOk;

  let overall: "CLEARED" | "FLAGGED" | "BLOCKED";
  let reason: string;
  if (allPassed) {
    overall = "CLEARED";
    reason = "All safety gate conditions satisfied.";
  } else if (criticalFailed) {
    overall = "BLOCKED";
    reason = checks.find((c) => !c.passed)?.detail ?? "A hard constraint failed.";
  } else {
    overall = "FLAGGED";
    reason = `Review required: ${checks.filter((c) => !c.passed).map((c) => c.label).join(", ")}`;
  }

  return { checks, overall, reason };
}
