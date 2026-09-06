/**
 * The ORION demo scenario: one primary CubeSat, one designated high-risk
 * debris threat, and a small tracked-object field around them.
 *
 * All objects are fabricated for this prototype (see tle.ts / covariance.ts
 * headers). The conjunction geometry between PRIMARY and the designated
 * THREAT is constructed analytically (see buildScenario below) so that a
 * genuine, reproducible close approach exists at a known time — instead of
 * hoping randomized orbital elements happen to cross paths. Everything
 * downstream (screening, Pc, B-plane, maneuver response) is then computed
 * for real from that physics, not hard-coded.
 */
import {
  StateVector,
  Vec3,
  add,
  scale,
  propagateKeplerian,
  rtnFrame,
  dot,
  unit,
} from "./kepler.js";
import { makeSgp4Object, propagateSgp4, OrbitDef } from "./tle.js";
import { Covariance2x2 } from "./covariance.js";

export type ObjectType = "SATELLITE" | "DEBRIS" | "ROCKET_BODY" | "INACTIVE";
export type RiskLevel = "SAFE" | "MODERATE" | "HIGH" | "CRITICAL";

export interface TrackedObject {
  id: string;
  name: string;
  type: ObjectType;
  /** synthetic per-object position uncertainty, used for the B-plane/Pc model */
  covariance: Covariance2x2;
  /** hard-body radius, km (combined with primary's HBR for Pc calc) */
  hardBodyRadiusKm: number;
  /** representative mass, kg — feeds the consequence factor in the risk score */
  massKg: number;
  /** seed state vector at scenario epoch0 */
  seedState: StateVector;
  isDesignatedThreat?: boolean;
}

export interface Scenario {
  epoch0: Date;
  tca: Date;
  windowStartSec: number; // offset from epoch0
  windowEndSec: number;
  primary: TrackedObject;
  threat: TrackedObject;
  nearby: TrackedObject[];
  designMissDistanceKm: number;
  designRelVelKms: number;
}

const EARTH_RADIUS_KM = 6378.137;

function buildPrimarySeed(epoch0: Date): StateVector {
  const def: OrbitDef = {
    noradId: 90001,
    name: "MUJ-CubeSat-01",
    inclinationDeg: 97.45,
    raanDeg: 63.2,
    eccentricity: 0.0012,
    argPerigeeDeg: 45.0,
    meanAnomalyDeg: 310.0,
    meanMotionRevPerDay: 15.19, // ~ 550 km altitude LEO
    epoch: epoch0,
  };
  const sgp4Obj = makeSgp4Object(def);
  const state = propagateSgp4(sgp4Obj, epoch0);
  if (!state) throw new Error("failed to seed primary orbit from SGP4");
  return state;
}

let cached: Scenario | null = null;

export function buildScenario(): Scenario {
  if (cached) return cached;

  const epoch0 = new Date(); // "now" = start of the T-2h..+2h demo window
  const TCA_OFFSET_SEC = 2 * 3600; // TCA sits 2h into the window
  const WINDOW_END_SEC = 4 * 3600; // window spans epoch0 .. epoch0+4h (i.e. TCA+2h)

  const primarySeed = buildPrimarySeed(epoch0);
  const primaryAtTCA = propagateKeplerian(primarySeed, TCA_OFFSET_SEC);
  const frame = rtnFrame(primaryAtTCA);

  const DESIGN_MISS_KM = 0.9;
  const DESIGN_REL_VEL_KMS = 11.8;

  // relative velocity: mostly cross-track (different orbital plane), a little along-track
  const relVelDirRaw: Vec3 = add(scale(frame.t, 0.18), scale(frame.n, 0.95));
  const relVelDir = unit(relVelDirRaw);
  const relVel = scale(relVelDir, DESIGN_REL_VEL_KMS);

  // miss vector must be orthogonal to relVel so t=TCA is an exact local range minimum
  const missRaw: Vec3 = add(scale(frame.r, 0.8), scale(frame.n, 0.4));
  const alongRelVel = dot(missRaw, relVelDir);
  const missOrthogonal: Vec3 = [
    missRaw[0] - alongRelVel * relVelDir[0],
    missRaw[1] - alongRelVel * relVelDir[1],
    missRaw[2] - alongRelVel * relVelDir[2],
  ];
  const missDir = unit(missOrthogonal);
  const missVec = scale(missDir, DESIGN_MISS_KM);

  const threatAtTCA: StateVector = {
    epoch: primaryAtTCA.epoch,
    position: add(primaryAtTCA.position, missVec),
    velocity: add(primaryAtTCA.velocity, relVel),
  };
  const threatSeed = propagateKeplerian(threatAtTCA, -TCA_OFFSET_SEC);

  const primary: TrackedObject = {
    id: "MUJ-CubeSat-01",
    name: "MUJ-CubeSat-01",
    type: "SATELLITE",
    covariance: { sigmaRadialKm: 0.03, sigmaAlongTrackKm: 0.12, sigmaCrossTrackKm: 0.04 },
    hardBodyRadiusKm: 0.005,
    massKg: 12, // 6U-class CubeSat
    seedState: primarySeed,
  };

  const threat: TrackedObject = {
    id: "DEB-47291",
    name: "DEB-47291",
    type: "DEBRIS",
    covariance: { sigmaRadialKm: 0.18, sigmaAlongTrackKm: 0.65, sigmaCrossTrackKm: 0.22 },
    hardBodyRadiusKm: 0.01,
    massKg: 140, // catalogued fragment, upper-stage break-up class
    seedState: threatSeed,
    isDesignatedThreat: true,
  };

  const nearby = buildNearbyField(primarySeed, epoch0);

  cached = {
    epoch0,
    tca: new Date(primaryAtTCA.epoch),
    windowStartSec: 0,
    windowEndSec: WINDOW_END_SEC,
    primary,
    threat,
    nearby,
    designMissDistanceKm: DESIGN_MISS_KM,
    designRelVelKms: DESIGN_REL_VEL_KMS,
  };
  return cached;
}

function buildNearbyField(primarySeed: StateVector, epoch0: Date): TrackedObject[] {
  const specs: Array<{ id: string; name: string; type: ObjectType; dIncl: number; dRaan: number; dAlt: number; risk: "SAFE" | "MODERATE" }> = [
    { id: "SAT-11042", name: "SAT-11042", type: "SATELLITE", dIncl: 0.4, dRaan: 2.1, dAlt: 12, risk: "SAFE" },
    { id: "SAT-20388", name: "SAT-20388", type: "SATELLITE", dIncl: -0.6, dRaan: -3.4, dAlt: -18, risk: "SAFE" },
    { id: "RB-30877", name: "RB-30877", type: "ROCKET_BODY", dIncl: 1.1, dRaan: 4.8, dAlt: 30, risk: "MODERATE" },
    { id: "DEB-19023", name: "DEB-19023", type: "DEBRIS", dIncl: -1.4, dRaan: 1.6, dAlt: -25, risk: "SAFE" },
    { id: "DEB-55210", name: "DEB-55210", type: "DEBRIS", dIncl: 0.9, dRaan: -2.2, dAlt: 8, risk: "MODERATE" },
    { id: "INACT-08871", name: "INACT-08871", type: "INACTIVE", dIncl: -0.3, dRaan: 3.9, dAlt: -40, risk: "SAFE" },
    { id: "SAT-40219", name: "SAT-40219", type: "SATELLITE", dIncl: 2.0, dRaan: -1.1, dAlt: 55, risk: "SAFE" },
    { id: "DEB-63102", name: "DEB-63102", type: "DEBRIS", dIncl: -2.3, dRaan: 5.5, dAlt: -60, risk: "SAFE" },
  ];

  return specs.map((s) => {
    const def: OrbitDef = {
      noradId: 90100 + specs.indexOf(s),
      name: s.name,
      inclinationDeg: 97.45 + s.dIncl,
      raanDeg: 63.2 + s.dRaan,
      eccentricity: 0.001 + Math.random() * 0.0015,
      argPerigeeDeg: 45 + s.dIncl * 10,
      meanAnomalyDeg: (310 + s.dRaan * 20 + 360) % 360,
      meanMotionRevPerDay: 15.19 * Math.pow((EARTH_RADIUS_KM + 550) / (EARTH_RADIUS_KM + 550 + s.dAlt), 1.5),
      epoch: epoch0,
    };
    const sgp4Obj = makeSgp4Object(def);
    const seedState = propagateSgp4(sgp4Obj, epoch0) ?? primarySeed;
    return {
      id: s.id,
      name: s.name,
      type: s.type,
      covariance: { sigmaRadialKm: 0.05, sigmaAlongTrackKm: 0.2, sigmaCrossTrackKm: 0.07 },
      hardBodyRadiusKm: 0.008,
      massKg: s.type === "ROCKET_BODY" ? 1400 : s.type === "SATELLITE" ? 260 : 45,
      seedState,
    } as TrackedObject;
  });
}
