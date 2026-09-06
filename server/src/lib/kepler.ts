/**
 * Minimal two-body (Keplerian) orbital mechanics used for:
 *  - propagating maneuver ("proposed"/"verified") trajectories from a state
 *    vector, since a Δv applied mid-flight cannot be re-expressed as a TLE
 *    without a full osculating->mean-element fit,
 *  - RTN (Radial / Transverse(along-track) / Normal(cross-track)) frame
 *    construction for applying an operator Δv,
 *  - general vector helpers shared across the scenario/covariance modules.
 *
 * This is NOT a high-fidelity propagator (no J2, drag, third-body, SRP).
 * For a hackathon decision-support prototype this is an explicit, documented
 * trade-off: see section 26/27 of the product spec ("prioritize clarity +
 * responsiveness + convincing orbital behavior"; "clearly indicate
 * DEMO/SIMULATED where covariance/Pc data is synthetic").
 */

export const MU_EARTH_KM3_S2 = 398600.4418; // km^3/s^2

export type Vec3 = [number, number, number];

export interface StateVector {
  /** epoch, ms since unix epoch */
  epoch: number;
  /** position, km, ECI-equivalent inertial frame */
  position: Vec3;
  /** velocity, km/s, same frame */
  velocity: Vec3;
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
export function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}
export function norm(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}
export function unit(a: Vec3): Vec3 {
  const n = norm(a);
  return n > 1e-12 ? scale(a, 1 / n) : [0, 0, 0];
}

/** Build the RTN (radial, along-track/transverse, cross-track/normal) basis at a state. */
export function rtnFrame(state: StateVector): { r: Vec3; t: Vec3; n: Vec3 } {
  const r = unit(state.position);
  const h = cross(state.position, state.velocity);
  const n = unit(h);
  const t = unit(cross(n, r));
  return { r, t, n };
}

/** Apply a Δv given in the RTN frame (km/s components) to a state vector's velocity. */
export function applyManeuverDeltaV(
  state: StateVector,
  dv: { radial: number; alongTrack: number; crossTrack: number }
): StateVector {
  const { r, t, n } = rtnFrame(state);
  const dvVec = add(
    add(scale(r, dv.radial), scale(t, dv.alongTrack)),
    scale(n, dv.crossTrack)
  );
  return {
    epoch: state.epoch,
    position: state.position,
    velocity: add(state.velocity, dvVec),
  };
}

/**
 * Propagate a two-body state vector forward/backward by `dtSeconds` using
 * Kepler's equation solved via the universal-variable (Stumpff) formulation,
 * which is stable for the whole ellipse and does not require iterating a
 * true-anomaly guess per revolution.
 */
export function propagateKeplerian(state: StateVector, dtSeconds: number): StateVector {
  const mu = MU_EARTH_KM3_S2;
  const r0 = state.position;
  const v0 = state.velocity;
  const r0n = norm(r0);
  const v0n = norm(v0);
  const vr0 = dot(r0, v0) / r0n;
  const alpha = 2 / r0n - (v0n * v0n) / mu; // 1/a

  // initial guess for universal anomaly
  let chi = Math.sqrt(mu) * Math.abs(alpha) * dtSeconds;
  if (Math.abs(alpha) < 1e-10) {
    // near-parabolic fallback guess
    const h = norm(cross(r0, v0));
    const p = (h * h) / mu;
    chi = Math.sqrt(p) * Math.sign(dtSeconds || 1);
  }

  const stumpffC = (z: number) =>
    z > 1e-8
      ? (1 - Math.cos(Math.sqrt(z))) / z
      : z < -1e-8
      ? (Math.cosh(Math.sqrt(-z)) - 1) / -z
      : 0.5;
  const stumpffS = (z: number) =>
    z > 1e-8
      ? (Math.sqrt(z) - Math.sin(Math.sqrt(z))) / Math.pow(z, 1.5)
      : z < -1e-8
      ? (Math.sinh(Math.sqrt(-z)) - Math.sqrt(-z)) / Math.pow(-z, 1.5)
      : 1 / 6;

  let ratio = 1;
  let iterations = 0;
  const sqrtMu = Math.sqrt(mu);
  while (Math.abs(ratio) > 1e-8 && iterations < 100) {
    const z = alpha * chi * chi;
    const C = stumpffC(z);
    const S = stumpffS(z);
    const F =
      (r0n * vr0) / sqrtMu * chi * chi * C +
      (1 - alpha * r0n) * chi * chi * chi * S +
      r0n * chi -
      sqrtMu * dtSeconds;
    const dF =
      (r0n * vr0) / sqrtMu * chi * (1 - alpha * chi * chi * S) +
      (1 - alpha * r0n) * chi * chi * C +
      r0n;
    ratio = F / dF;
    chi -= ratio;
    iterations += 1;
  }

  const z = alpha * chi * chi;
  const C = stumpffC(z);
  const S = stumpffS(z);

  const f = 1 - (chi * chi * C) / r0n;
  const g = dtSeconds - (chi * chi * chi * S) / sqrtMu;

  const r1 = add(scale(r0, f), scale(v0, g));
  const r1n = norm(r1);

  const fDot = (sqrtMu / (r1n * r0n)) * (alpha * chi * chi * chi * S - chi);
  const gDot = 1 - (chi * chi * C) / r1n;

  const v1 = add(scale(r0, fDot), scale(v0, gDot));

  return {
    epoch: state.epoch + dtSeconds * 1000,
    position: r1,
    velocity: v1,
  };
}

/** Sample a trajectory as an array of states between two offsets (seconds) from a base state's epoch. */
export function sampleTrajectory(
  state: StateVector,
  startOffsetSec: number,
  endOffsetSec: number,
  stepSec: number
): StateVector[] {
  const out: StateVector[] = [];
  for (let t = startOffsetSec; t <= endOffsetSec + 1e-6; t += stepSec) {
    out.push(propagateKeplerian(state, t));
  }
  return out;
}

/** Relative position/velocity of B with respect to A. */
export function relativeState(a: StateVector, b: StateVector) {
  return {
    position: sub(b.position, a.position),
    velocity: sub(b.velocity, a.velocity),
  };
}
