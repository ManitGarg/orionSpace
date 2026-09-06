import * as Cesium from "cesium";
import type { TrajectorySample } from "../api/types";

/** Convert a [x,y,z] km vector into a Cesium Cartesian3 in meters. */
export function kmToCartesian(p: readonly [number, number, number]): Cesium.Cartesian3 {
  return new Cesium.Cartesian3(p[0] * 1000, p[1] * 1000, p[2] * 1000);
}

/** Build a SampledPositionProperty (inertial frame) from trajectory samples relative to epoch0. */
export function buildSampledPosition(
  epoch0: Cesium.JulianDate,
  samples: TrajectorySample[]
): Cesium.SampledPositionProperty {
  const prop = new Cesium.SampledPositionProperty(Cesium.ReferenceFrame.INERTIAL);
  prop.forwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
  prop.backwardExtrapolationType = Cesium.ExtrapolationType.HOLD;
  prop.setInterpolationOptions({
    interpolationDegree: 3,
    interpolationAlgorithm: Cesium.LagrangePolynomialApproximation,
  });
  for (const s of samples) {
    const t = Cesium.JulianDate.addSeconds(epoch0, s.t, new Cesium.JulianDate());
    prop.addSample(t, kmToCartesian(s.position));
  }
  return prop;
}

export function julianAt(epoch0: Cesium.JulianDate, offsetSec: number): Cesium.JulianDate {
  return Cesium.JulianDate.addSeconds(epoch0, offsetSec, new Cesium.JulianDate());
}

/** Linear interpolation of a sample array (uniform or non-uniform step) at time t (sec offset). */
export function interpolateSamples(samples: TrajectorySample[], t: number): TrajectorySample | null {
  if (samples.length === 0) return null;
  if (t <= samples[0].t) return samples[0];
  if (t >= samples[samples.length - 1].t) return samples[samples.length - 1];
  // binary search
  let lo = 0;
  let hi = samples.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (samples[mid].t <= t) lo = mid;
    else hi = mid;
  }
  const a = samples[lo];
  const b = samples[hi];
  const f = (t - a.t) / (b.t - a.t);
  const lerp3 = (u: [number, number, number], v: [number, number, number]): [number, number, number] => [
    u[0] + (v[0] - u[0]) * f,
    u[1] + (v[1] - u[1]) * f,
    u[2] + (v[2] - u[2]) * f,
  ];
  return { t, position: lerp3(a.position, b.position), velocity: lerp3(a.velocity, b.velocity) };
}

/** Build the 3x3 RTN (radial/along-track/cross-track) rotation matrix at a state, for orienting ellipsoids/rings. */
export function rtnRotationMatrix(position: [number, number, number], velocity: [number, number, number]): Cesium.Matrix3 {
  const r = Cesium.Cartesian3.normalize(kmToCartesian(position), new Cesium.Cartesian3());
  const h = Cesium.Cartesian3.cross(kmToCartesian(position), kmToCartesian(velocity), new Cesium.Cartesian3());
  const n = Cesium.Cartesian3.normalize(h, new Cesium.Cartesian3());
  const t = Cesium.Cartesian3.normalize(
    Cesium.Cartesian3.cross(n, r, new Cesium.Cartesian3()),
    new Cesium.Cartesian3()
  );
  // columns: R, T, N
  return new Cesium.Matrix3(r.x, t.x, n.x, r.y, t.y, n.y, r.z, t.z, n.z);
}

export function formatKm(km: number, digits = 2): string {
  if (Math.abs(km) >= 1000) return `${(km / 1000).toFixed(digits)}k km`;
  return `${km.toFixed(digits)} km`;
}

/** Matches the server's PC_FLOOR — below this, Pc is reported as "negligible" rather than a spurious tail value. */
export const PC_FLOOR = 1e-8;

export function formatPc(pc: number): string {
  if (pc <= 0) return "≈0";
  if (pc <= PC_FLOOR) return "< 1 × 10⁻⁸";
  return pc.toExponential(1).replace("e", " × 10");
}

export function formatDuration(sec: number): string {
  const sign = sec < 0 ? "-" : "";
  const abs = Math.abs(sec);
  const h = Math.floor(abs / 3600);
  const m = Math.floor((abs % 3600) / 60);
  const s = Math.floor(abs % 60);
  if (h > 0) return `${sign}${h}h ${m}m`;
  if (m > 0) return `${sign}${m}m ${s}s`;
  return `${sign}${s}s`;
}
