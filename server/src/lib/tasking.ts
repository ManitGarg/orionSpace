/**
 * Mission continuity: does the collision-avoidance maneuver cost us the task,
 * and if so, who can take it over?
 *
 * The feasibility verdict is *computed from the maneuver*, not asserted. Two
 * real effects are modelled, because they are the two that actually decide
 * whether a spacecraft can still service an imaging tasking after a CA burn:
 *
 *  1. Attitude outage. A collision-avoidance burn requires slewing to thrust
 *     attitude, burning, then re-stabilising and re-acquiring attitude
 *     reference before the payload can point again. For a CubeSat with a
 *     low-thrust propulsion system this is tens of minutes, and it scales with
 *     Δv (a bigger burn is a longer burn). If the target access window falls
 *     inside that outage, the spacecraft physically cannot take the image.
 *     For a small along-track burn this is the dominant effect.
 *
 *  2. Ground-track displacement. A cross-track Δv moves the ground track
 *     laterally; if the target ends up outside the sensor's swath, the image
 *     cannot be taken regardless of timing. An along-track Δv mostly shifts
 *     arrival *time* rather than track position, which is why an along-track
 *     burn alone rarely breaks pointing — the engine reports that honestly.
 *
 * Both are driven by the operator's actual burn time and Δv, so moving the
 * burn away from the access window genuinely preserves the task. That is the
 * decision-support value: ORION can tell the operator that their maneuver is
 * sound for collision avoidance but lands on top of their imaging pass.
 */
import { propagateKeplerian, norm, sub, StateVector } from "./kepler.js";
import { eciToGeodetic } from "./tle.js";
import { Scenario } from "./scenario.js";
import { ManeuverSimulationResult } from "./maneuver.js";

export type TaskStatus = "IN_PROGRESS" | "NO_LONGER_FEASIBLE" | "REASSIGNED" | "AT_RISK";
export type MissionOutcome = "PRESERVED" | "AT_RISK";

export interface MissionTask {
  taskId: string;
  mission: string;
  target: string;
  targetLatDeg: number;
  targetLonDeg: number;
  priority: "ROUTINE" | "HIGH" | "CRITICAL";
  deadlineMinutes: number;
  assignedSatellite: string;
  status: TaskStatus;
  /** offset from scenario epoch at which SAT-A nominally images the target, seconds */
  nominalAccessOffsetSec: number;
}

export interface CandidateEvaluation {
  satelliteId: string;
  available: boolean;
  collisionRisk: "ACCEPTABLE" | "ELEVATED";
  sensorCompatible: boolean;
  timeToTargetMinutes: number;
  withinDeadline: boolean;
  feasible: boolean;
  note: string;
}

export interface TaskImpact {
  /** attitude outage caused by the burn, as offsets from scenario epoch (seconds) */
  outageStartSec: number;
  outageEndSec: number;
  outageMinutes: number;
  /** when SAT-A nominally images the target */
  nominalAccessOffsetSec: number;
  /** closest the post-maneuver ground track comes to the target, km */
  postManeuverGroundRangeKm: number;
  /** sensor half-swath: the target must be within this to be imageable */
  sensorSwathKm: number;
  /** how much the burn shifted SAT-A's arrival at the imaging geometry, seconds */
  arrivalShiftSec: number;
  accessInsideOutage: boolean;
  outsideSwath: boolean;
  stillFeasible: boolean;
  reason: string;
}

export interface TimelineEvent {
  at: string;
  label: string;
}

export interface TaskingAssessment {
  task: MissionTask;
  impact: TaskImpact;
  candidates: CandidateEvaluation[];
  selectedSatellite: string | null;
  outcome: MissionOutcome;
  outcomeDetail: string;
  timeline: TimelineEvent[];
  disclaimer: string;
}

const TASK_TEMPLATE = {
  taskId: "TASK-001",
  mission: "Disaster Zone Imaging",
  target: "Disaster Zone Alpha",
  priority: "CRITICAL" as const,
  deadlineMinutes: 60,
  assignedSatellite: "SAT-A",
};

/** Optical sensor half-swath, km. Beyond this the target falls outside the access cone. */
const SENSOR_SWATH_KM = 42;

/**
 * Attitude/propulsion model for the primary (6U CubeSat class):
 * slew to thrust attitude, burn at low thrust, then settle and re-acquire
 * attitude reference before the payload is usable again.
 */
const SLEW_TO_THRUST_MIN = 4;
const SETTLE_AND_REACQUIRE_MIN = 6;
/** low-thrust CubeSat propulsion: minutes of burn per m/s of Δv */
const BURN_MINUTES_PER_MS = 20;

/**
 * The tasked target. Defined as the point SAT-A overflies at
 * TARGET_ACCESS_OFFSET_SEC, so the access window is a real consequence of the
 * orbit rather than an arbitrary lat/lon that the spacecraft never passes.
 */
const TARGET_ACCESS_OFFSET_SEC = 38 * 60;

const FLEET = [
  {
    satelliteId: "SAT-B",
    available: true,
    collisionRisk: "ACCEPTABLE" as const,
    sensorCompatible: true,
    timeToTargetMinutes: 27,
  },
  {
    satelliteId: "SAT-C",
    available: true,
    collisionRisk: "ELEVATED" as const,
    sensorCompatible: true,
    timeToTargetMinutes: 34,
  },
  {
    satelliteId: "SAT-D",
    available: false,
    collisionRisk: "ACCEPTABLE" as const,
    sensorCompatible: false,
    timeToTargetMinutes: 71,
  },
];

const EARTH_RADIUS_KM = 6378.137;

/** Great-circle distance between two geodetic points, km. */
function groundRangeKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

function subSatellitePoint(state: StateVector) {
  const geo = eciToGeodetic(state);
  return { lat: geo.latitudeDeg, lon: geo.longitudeDeg };
}

/** The target: the ground point SAT-A nominally overflies at the access time. */
function targetLocation(scenario: Scenario) {
  const state = propagateKeplerian(scenario.primary.seedState, TARGET_ACCESS_OFFSET_SEC);
  return subSatellitePoint({ ...state, epoch: scenario.epoch0.getTime() + TARGET_ACCESS_OFFSET_SEC * 1000 });
}

/**
 * Search a trajectory for its closest ground approach to the target within a
 * window, returning both the range and when it occurs.
 */
function closestGroundApproach(
  seed: StateVector,
  epoch0Ms: number,
  target: { lat: number; lon: number },
  startSec: number,
  endSec: number
): { rangeKm: number; atSec: number } {
  let best = { rangeKm: Infinity, atSec: startSec };
  const STEP_SEC = 10;
  for (let t = startSec; t <= endSec; t += STEP_SEC) {
    const st = propagateKeplerian(seed, t);
    const ssp = subSatellitePoint({ ...st, epoch: epoch0Ms + t * 1000 });
    const r = groundRangeKm(ssp.lat, ssp.lon, target.lat, target.lon);
    if (r < best.rangeKm) best = { rangeKm: r, atSec: t };
  }
  return best;
}

export function assessTaskImpact(scenario: Scenario, sim: ManeuverSimulationResult): TaskImpact {
  const epoch0Ms = scenario.epoch0.getTime();
  const target = targetLocation(scenario);

  // Attitude outage produced by this specific burn.
  const burnMinutes = sim.deltaVMagnitudeMs * BURN_MINUTES_PER_MS;
  const outageStartSec = sim.burnOffsetSec - SLEW_TO_THRUST_MIN * 60;
  const outageEndSec = sim.burnOffsetSec + (burnMinutes + SETTLE_AND_REACQUIRE_MIN) * 60;

  // Where the post-maneuver track actually passes the target, and when.
  const searchStart = Math.max(0, TARGET_ACCESS_OFFSET_SEC - 20 * 60);
  const searchEnd = TARGET_ACCESS_OFFSET_SEC + 20 * 60;
  const post = closestGroundApproach(sim.proposedSeed, epoch0Ms, target, searchStart, searchEnd);

  const accessInsideOutage = post.atSec >= outageStartSec && post.atSec <= outageEndSec;
  const outsideSwath = post.rangeKm > SENSOR_SWATH_KM;
  const stillFeasible = !accessInsideOutage && !outsideSwath;

  const reasons: string[] = [];
  if (accessInsideOutage) {
    reasons.push(
      `the target access window at T+${(post.atSec / 60).toFixed(0)} min falls inside the ${(
        (outageEndSec - outageStartSec) / 60
      ).toFixed(0)} min attitude outage required to execute the ${sim.deltaVMagnitudeMs.toFixed(
        2
      )} m/s burn (T+${(outageStartSec / 60).toFixed(0)} to T+${(outageEndSec / 60).toFixed(0)} min)`
    );
  }
  if (outsideSwath) {
    reasons.push(
      `the post-maneuver ground track passes ${post.rangeKm.toFixed(1)} km from the target, outside the ${SENSOR_SWATH_KM} km sensor swath`
    );
  }

  return {
    outageStartSec,
    outageEndSec,
    outageMinutes: (outageEndSec - outageStartSec) / 60,
    nominalAccessOffsetSec: TARGET_ACCESS_OFFSET_SEC,
    postManeuverGroundRangeKm: post.rangeKm,
    sensorSwathKm: SENSOR_SWATH_KM,
    arrivalShiftSec: post.atSec - TARGET_ACCESS_OFFSET_SEC,
    accessInsideOutage,
    outsideSwath,
    stillFeasible,
    reason: stillFeasible
      ? `SAT-A retains the imaging opportunity: the access window at T+${(post.atSec / 60).toFixed(
          0
        )} min clears the attitude outage and the target stays ${post.rangeKm.toFixed(
          1
        )} km from the ground track, inside the ${SENSOR_SWATH_KM} km swath.`
      : `The avoidance maneuver invalidated SAT-A's original target imaging opportunity — ${reasons.join(
          " and "
        )}.`,
  };
}

function evaluateCandidates(deadlineMinutes: number): CandidateEvaluation[] {
  return FLEET.map((c) => {
    const withinDeadline = c.timeToTargetMinutes <= deadlineMinutes;
    const feasible = c.available && c.sensorCompatible && withinDeadline && c.collisionRisk === "ACCEPTABLE";
    let note: string;
    if (!c.available) note = "Not available — committed to a higher-priority tasking.";
    else if (!c.sensorCompatible) note = "Sensor payload incompatible with the requested imaging product.";
    else if (!withinDeadline) note = `Time to target ${c.timeToTargetMinutes} min exceeds the ${deadlineMinutes} min deadline.`;
    else if (c.collisionRisk === "ELEVATED") note = "Own conjunction risk elevated — not eligible to accept a critical task.";
    else note = `Available, compatible, and reaches the target in ${c.timeToTargetMinutes} min.`;
    return {
      satelliteId: c.satelliteId,
      available: c.available,
      collisionRisk: c.collisionRisk,
      sensorCompatible: c.sensorCompatible,
      timeToTargetMinutes: c.timeToTargetMinutes,
      withinDeadline,
      feasible,
      note,
    };
  });
}

export function assessTasking(
  scenario: Scenario,
  sim: ManeuverSimulationResult,
  eventBase: Date = new Date()
): TaskingAssessment {
  const impact = assessTaskImpact(scenario, sim);
  const candidates = evaluateCandidates(TASK_TEMPLATE.deadlineMinutes);

  // Prefer the feasible candidate that reaches the target soonest.
  const selected = candidates
    .filter((c) => c.feasible)
    .sort((a, b) => a.timeToTargetMinutes - b.timeToTargetMinutes)[0];

  const reassignmentNeeded = !impact.stillFeasible;
  const selectedSatellite = reassignmentNeeded ? selected?.satelliteId ?? null : null;

  let status: TaskStatus;
  let outcome: MissionOutcome;
  let outcomeDetail: string;

  if (!reassignmentNeeded) {
    status = "IN_PROGRESS";
    outcome = "PRESERVED";
    outcomeDetail = impact.reason;
  } else if (selectedSatellite) {
    status = "REASSIGNED";
    outcome = "PRESERVED";
    outcomeDetail = `Task successfully reassigned from SAT-A to ${selectedSatellite}. ${selected!.note}`;
  } else {
    status = "AT_RISK";
    outcome = "AT_RISK";
    outcomeDetail = "No suitable replacement satellite was available within the mission deadline.";
  }

  const target = targetLocation(scenario);

  return {
    task: {
      ...TASK_TEMPLATE,
      targetLatDeg: target.lat,
      targetLonDeg: target.lon,
      nominalAccessOffsetSec: TARGET_ACCESS_OFFSET_SEC,
      status,
    },
    impact,
    candidates,
    selectedSatellite,
    outcome,
    outcomeDetail,
    timeline: buildTimeline(eventBase, selectedSatellite, reassignmentNeeded),
    disclaimer:
      "DEMO / SIMULATED — fleet availability, sensor compatibility and time-to-target are prototype values; SAT-A's feasibility verdict is computed from the simulated maneuver.",
  };
}

/** The unmaneuvered baseline: the task as it stands before any burn is simulated. */
export function baselineTask(scenario: Scenario): MissionTask {
  const target = targetLocation(scenario);
  return {
    ...TASK_TEMPLATE,
    targetLatDeg: target.lat,
    targetLonDeg: target.lon,
    nominalAccessOffsetSec: TARGET_ACCESS_OFFSET_SEC,
    status: "IN_PROGRESS",
  };
}

function buildTimeline(base: Date, selectedSatellite: string | null, reassignmentNeeded: boolean): TimelineEvent[] {
  const at = (offsetSec: number) => new Date(base.getTime() + offsetSec * 1000).toISOString();
  const events: TimelineEvent[] = [
    { at: at(-18 * 60), label: `${TASK_TEMPLATE.taskId} assigned to SAT-A` },
    { at: at(-5 * 60), label: "High-risk conjunction detected for SAT-A" },
    { at: at(-2 * 60), label: "Collision avoidance maneuver simulated" },
    { at: at(-60), label: "SAT-A trajectory updated" },
  ];

  if (!reassignmentNeeded) {
    events.push({ at: at(0), label: "Imaging window re-validated — SAT-A retains the task" });
    events.push({ at: at(0), label: "MISSION PRESERVED" });
    return events;
  }

  events.push({ at: at(-30), label: "Original imaging window invalidated" });
  events.push({ at: at(0), label: "Automatic re-tasking initiated" });
  if (selectedSatellite) {
    events.push({ at: at(30), label: `${selectedSatellite} selected as replacement` });
    events.push({ at: at(60), label: `${TASK_TEMPLATE.taskId} reassigned to ${selectedSatellite}` });
    events.push({ at: at(60), label: "MISSION PRESERVED" });
  } else {
    events.push({ at: at(30), label: "No feasible replacement satellite found" });
    events.push({ at: at(30), label: "MISSION AT RISK" });
  }
  return events;
}
