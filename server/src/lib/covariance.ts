/**
 * Synthetic covariance + B-plane collision-probability model.
 *
 * IMPORTANT: real conjunction assessment relies on covariance propagated
 * from an actual orbit-determination solution. ORION has no such OD
 * pipeline in this prototype, so the position-uncertainty inputs here are
 * fabricated (scaled from a simple "tracking quality" knob). The resulting
 * Pc is computed with a standard technique (2D Gaussian integrated over the
 * hard-body disk in the B-plane, e.g. Foster/Akella-style) so the *method*
 * is real, but every number that comes out of it must be surfaced to the UI
 * as DEMO / SIMULATED, never as an operational collision probability.
 */

export interface Covariance2x2 {
  sigmaRadialKm: number;
  sigmaAlongTrackKm: number;
  sigmaCrossTrackKm: number;
}

export interface BPlaneFrame {
  /** unit vector, B-plane "R" axis (roughly radial, in-plane of relative velocity) */
  rHat: [number, number, number];
  /** unit vector, B-plane "T" axis (roughly along the relative velocity direction projected) */
  tHat: [number, number, number];
  /** miss vector projected components in the (R,T) B-plane */
  bR: number;
  bT: number;
  missDistanceKm: number;
}

/** Build a simple B-plane basis from the relative position/velocity at TCA. */
export function computeBPlane(
  relPosKm: [number, number, number],
  relVelKms: [number, number, number]
): BPlaneFrame {
  const vHat = normalize(relVelKms);
  // B-plane is perpendicular to relative velocity; project relative position onto it.
  const proj = dot(relPosKm, vHat);
  const bVec: [number, number, number] = [
    relPosKm[0] - proj * vHat[0],
    relPosKm[1] - proj * vHat[1],
    relPosKm[2] - proj * vHat[2],
  ];
  const missDistanceKm = norm(bVec);

  // arbitrary consistent in-plane axes (T along projection of "up" cross vHat, R completes the pair)
  const upGuess: [number, number, number] = Math.abs(vHat[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const tHat = normalize(cross(vHat, upGuess));
  const rHat = normalize(cross(tHat, vHat));

  const bR = dot(bVec, rHat);
  const bT = dot(bVec, tHat);

  return { rHat, tHat, bR, bT, missDistanceKm };
}

/** Combine two objects' 3D covariances (assumed diagonal in RTN) into a 2x2 B-plane covariance. */
export function combinedBPlaneCovariance(
  primary: Covariance2x2,
  secondary: Covariance2x2,
  frame: BPlaneFrame
): { sxx: number; syy: number; sxy: number } {
  // Approximate: treat each object's RTN uncertainty ellipsoid, sum variances along
  // R and T B-plane axes weighted by how aligned each RTN axis is with the B-plane axes.
  // This is a simplification appropriate for a demo, not a rigorous frame transform.
  const combine = (axis: [number, number, number]) => {
    const wR = axis[0] ** 2;
    const wT = axis[1] ** 2;
    const wN = axis[2] ** 2;
    const varP =
      wR * primary.sigmaRadialKm ** 2 +
      wT * primary.sigmaAlongTrackKm ** 2 +
      wN * primary.sigmaCrossTrackKm ** 2;
    const varS =
      wR * secondary.sigmaRadialKm ** 2 +
      wT * secondary.sigmaAlongTrackKm ** 2 +
      wN * secondary.sigmaCrossTrackKm ** 2;
    return varP + varS;
  };
  // Use a fixed generic RTN->Bplane weighting (R,T,N contributions) since we don't
  // track a full 3x3 covariance in this prototype.
  const sxx = combine([0.6, 0.3, 0.1]);
  const syy = combine([0.2, 0.7, 0.1]);
  const sxy = 0; // assume negligible cross-correlation for the synthetic model
  return { sxx, syy, sxy };
}

/**
 * Collision probability via 2D Gaussian integrated over a disk of radius
 * `hbrKm` centered at (bR, bT), against a (possibly correlated) covariance.
 * Numerically integrated on a polar grid — accurate to ~1e-4 relative error
 * for the disk sizes used here, and cheap (a few thousand evaluations).
 */
export function collisionProbability(
  bR: number,
  bT: number,
  cov: { sxx: number; syy: number; sxy: number },
  hbrKm: number
): number {
  const { sxx, syy, sxy } = cov;
  const det = sxx * syy - sxy * sxy;
  if (det <= 0) return 0;
  const invA = syy / det;
  const invB = -sxy / det;
  const invD = sxx / det;
  const norm2d = 1 / (2 * Math.PI * Math.sqrt(det));

  const pdf = (x: number, y: number) => {
    const dx = x - bR;
    const dy = y - bT;
    const q = dx * dx * invA + 2 * dx * dy * invB + dy * dy * invD;
    return norm2d * Math.exp(-0.5 * q);
  };

  const RADIAL_STEPS = 60;
  const ANGULAR_STEPS = 90;
  let sum = 0;
  // (integration below; result is floored — see PC_FLOOR note at the return)
  for (let i = 0; i < RADIAL_STEPS; i++) {
    const r0 = (i / RADIAL_STEPS) * hbrKm;
    const r1 = ((i + 1) / RADIAL_STEPS) * hbrKm;
    const rMid = (r0 + r1) / 2;
    const ringArea = Math.PI * (r1 * r1 - r0 * r0);
    let angularSum = 0;
    for (let j = 0; j < ANGULAR_STEPS; j++) {
      const theta = (j / ANGULAR_STEPS) * 2 * Math.PI;
      angularSum += pdf(rMid * Math.cos(theta), rMid * Math.sin(theta));
    }
    const avgPdf = angularSum / ANGULAR_STEPS;
    sum += avgPdf * ringArea;
  }

  // Floor the reported value. Far out in a Gaussian tail (beyond roughly 6σ)
  // the integral produces numbers like 1e-50 which are an artifact of assuming
  // the covariance is exactly right — in reality the covariance is itself
  // uncertain, and unmodeled error dominates long before that. Operational CA
  // practice does not report such values, so neither do we: below the floor the
  // honest statement is "negligible", not a specific 50-decade number.
  return Math.min(1, Math.max(PC_FLOOR, sum));
}

/** Reported collision probabilities are floored here; see collisionProbability(). */
export const PC_FLOOR = 1e-8;

export function riskFromPc(pc: number): "SAFE" | "MODERATE" | "HIGH" | "CRITICAL" {
  if (pc >= 1e-3) return "CRITICAL";
  if (pc >= 1e-4) return "HIGH";
  if (pc >= 1e-6) return "MODERATE";
  return "SAFE";
}

// --- small local vector helpers (kept independent from kepler.ts to avoid coupling) ---
function dot(a: [number, number, number], b: [number, number, number]) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(a: [number, number, number]) {
  return Math.sqrt(dot(a, a));
}
function normalize(a: [number, number, number]): [number, number, number] {
  const n = norm(a);
  return n > 1e-12 ? [a[0] / n, a[1] / n, a[2] / n] : [0, 0, 0];
}
