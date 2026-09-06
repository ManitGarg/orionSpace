/**
 * SGP4 propagation via satellite.js, plus synthetic (but checksum-valid) TLE
 * generation for the demo constellation. These are NOT real tracked objects
 * — they are fabricated for the ORION prototype demo and must be presented
 * as DEMO / SIMULATED, per the product spec's prototype disclaimer.
 */
import * as satellite from "satellite.js";
import type { StateVector, Vec3 } from "./kepler.js";

export interface OrbitDef {
  /** NORAD-style catalog number (fabricated) */
  noradId: number;
  name: string;
  inclinationDeg: number;
  raanDeg: number;
  eccentricity: number;
  argPerigeeDeg: number;
  meanAnomalyDeg: number;
  meanMotionRevPerDay: number;
  epoch: Date;
}

function tleChecksum(line: string): number {
  let sum = 0;
  for (const ch of line) {
    if (ch >= "0" && ch <= "9") sum += ch.charCodeAt(0) - 48;
    else if (ch === "-") sum += 1;
  }
  return sum % 10;
}

function pad(num: number, width: number, decimals = 0): string {
  const fixed = decimals > 0 ? num.toFixed(decimals) : Math.trunc(num).toString();
  return fixed.padStart(width, "0");
}

/** Build a syntactically-valid TLE pair for a fabricated demo object. */
export function buildTLE(def: OrbitDef): [string, string] {
  const epochYear = def.epoch.getUTCFullYear() % 100;
  const start = Date.UTC(def.epoch.getUTCFullYear(), 0, 1);
  const dayOfYear = (def.epoch.getTime() - start) / 86400000 + 1;

  const line1 = `1 ${pad(def.noradId, 5)}U 26001A   ${pad(epochYear, 2)}${dayOfYear
    .toFixed(8)
    .padStart(12, "0")}  .00000000  00000-0  00000-0 0  0009`;
  const l1Check = tleChecksum(line1.slice(0, 68));
  const line1Full = `${line1.slice(0, 68)}${l1Check}`;

  const eccStr = Math.round(def.eccentricity * 1e7)
    .toString()
    .padStart(7, "0");
  const line2 = `2 ${pad(def.noradId, 5)} ${def.inclinationDeg
    .toFixed(4)
    .padStart(8, "0")} ${def.raanDeg.toFixed(4).padStart(8, "0")} ${eccStr} ${def.argPerigeeDeg
    .toFixed(4)
    .padStart(8, "0")} ${def.meanAnomalyDeg.toFixed(4).padStart(8, "0")} ${def.meanMotionRevPerDay
    .toFixed(8)
    .padStart(11, "0")}00000`;
  const l2Check = tleChecksum(line2.slice(0, 68));
  const line2Full = `${line2.slice(0, 68)}${l2Check}`;

  return [line1Full, line2Full];
}

export interface Sgp4Object {
  def: OrbitDef;
  tle: [string, string];
  satrec: satellite.SatRec;
}

export function makeSgp4Object(def: OrbitDef): Sgp4Object {
  const tle = buildTLE(def);
  const satrec = satellite.twoline2satrec(tle[0], tle[1]);
  return { def, tle, satrec };
}

/**
 * Propagate an SGP4 object to a given time and return an inertial (TEME)
 * state vector in km / km-s, in the same [x,y,z] convention used by the
 * Keplerian helpers in kepler.ts (treated as a generic inertial frame).
 */
export function propagateSgp4(obj: Sgp4Object, at: Date): StateVector | null {
  const pv = satellite.propagate(obj.satrec, at);
  if (!pv.position || !pv.velocity || typeof pv.position === "boolean") return null;
  const p = pv.position as satellite.EciVec3<number>;
  const v = pv.velocity as satellite.EciVec3<number>;
  return {
    epoch: at.getTime(),
    position: [p.x, p.y, p.z] as Vec3,
    velocity: [v.x, v.y, v.z] as Vec3,
  };
}

export function eciToGeodetic(state: StateVector) {
  const gmst = satellite.gstime(new Date(state.epoch));
  const geo = satellite.eciToGeodetic(
    { x: state.position[0], y: state.position[1], z: state.position[2] },
    gmst
  );
  return {
    latitudeDeg: satellite.degreesLat(geo.latitude),
    longitudeDeg: satellite.degreesLong(geo.longitude),
    altitudeKm: geo.height,
  };
}
