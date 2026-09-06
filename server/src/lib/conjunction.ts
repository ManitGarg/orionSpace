import {
  StateVector,
  propagateKeplerian,
  relativeState,
  norm,
} from "./kepler.js";
import {
  computeBPlane,
  combinedBPlaneCovariance,
  collisionProbability,
  riskFromPc,
  Covariance2x2,
  BPlaneFrame,
} from "./covariance.js";
import { computeRiskScore, RiskScore } from "./risk.js";

const EARTH_RADIUS_KM = 6378.137;

export interface ConjunctionResult {
  tcaOffsetSec: number;
  tcaIso: string;
  missDistanceKm: number;
  relativeVelocityKms: number;
  collisionProbability: number;
  risk: "SAFE" | "MODERATE" | "HIGH" | "CRITICAL";
  bplane: BPlaneFrame;
  combinedCovariance: { sxx: number; syy: number; sxy: number };
  hbrKm: number;
  /** R = Pc × C, with the consequence breakdown that produced C */
  scoring: RiskScore;
  /** encounter altitude at TCA, km — an input to the consequence factor */
  altitudeKm: number;
  primaryStateAtTca: StateVector;
  secondaryStateAtTca: StateVector;
}

/**
 * Coarse-to-fine search for the time of closest approach between two
 * propagated objects over [startSec, endSec] (offsets from a shared epoch).
 * `propA`/`propB` are functions returning a state at a given offset second.
 */
export function findTCA(
  propA: (tSec: number) => StateVector,
  propB: (tSec: number) => StateVector,
  startSec: number,
  endSec: number
): number {
  const rangeAt = (t: number) => norm(relativeState(propA(t), propB(t)).position);

  let bestT = startSec;
  let bestRange = Infinity;
  let coarseStep = Math.max(1, (endSec - startSec) / 400);
  for (let t = startSec; t <= endSec; t += coarseStep) {
    const r = rangeAt(t);
    if (r < bestRange) {
      bestRange = r;
      bestT = t;
    }
  }

  // golden-section-ish refine around bestT
  let lo = Math.max(startSec, bestT - coarseStep);
  let hi = Math.min(endSec, bestT + coarseStep);
  for (let iter = 0; iter < 40; iter++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (rangeAt(m1) < rangeAt(m2)) hi = m2;
    else lo = m1;
  }
  return (lo + hi) / 2;
}

export function assessConjunction(
  primarySeed: StateVector,
  secondarySeed: StateVector,
  primaryCov: Covariance2x2,
  secondaryCov: Covariance2x2,
  combinedHbrKm: number,
  searchStartSec: number,
  searchEndSec: number,
  /** secondary object mass, kg — feeds the consequence factor of the risk score */
  secondaryMassKg = 140
): ConjunctionResult {
  const propA = (t: number) => propagateKeplerian(primarySeed, t - 0);
  const propB = (t: number) => propagateKeplerian(secondarySeed, t - 0);

  const tca = findTCA(propA, propB, searchStartSec, searchEndSec);
  const a = propA(tca);
  const b = propB(tca);
  const rel = {
    position: [b.position[0] - a.position[0], b.position[1] - a.position[1], b.position[2] - a.position[2]] as [
      number,
      number,
      number
    ],
    velocity: [b.velocity[0] - a.velocity[0], b.velocity[1] - a.velocity[1], b.velocity[2] - a.velocity[2]] as [
      number,
      number,
      number
    ],
  };
  const missDistanceKm = Math.sqrt(rel.position[0] ** 2 + rel.position[1] ** 2 + rel.position[2] ** 2);
  const relativeVelocityKms = Math.sqrt(rel.velocity[0] ** 2 + rel.velocity[1] ** 2 + rel.velocity[2] ** 2);

  const bplane = computeBPlane(rel.position, rel.velocity);
  const cov = combinedBPlaneCovariance(primaryCov, secondaryCov, bplane);
  const pc = collisionProbability(bplane.bR, bplane.bT, cov, combinedHbrKm);

  const altitudeKm = norm(a.position) - EARTH_RADIUS_KM;
  const scoring = computeRiskScore(pc, {
    secondaryMassKg,
    relativeVelocityKms,
    altitudeKm,
  });

  return {
    tcaOffsetSec: tca,
    tcaIso: new Date(a.epoch).toISOString(),
    missDistanceKm,
    relativeVelocityKms,
    collisionProbability: pc,
    risk: riskFromPc(pc),
    bplane,
    combinedCovariance: cov,
    hbrKm: combinedHbrKm,
    scoring,
    altitudeKm,
    primaryStateAtTca: a,
    secondaryStateAtTca: b,
  };
}
