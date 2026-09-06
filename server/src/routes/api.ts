import { Router } from "express";
import { buildScenario, TrackedObject } from "../lib/scenario.js";
import { propagateKeplerian, StateVector } from "../lib/kepler.js";
import { sampleOffsetTrajectory } from "../lib/trajectory.js";
import { assessConjunction, ConjunctionResult } from "../lib/conjunction.js";
import { simulateManeuver, HBR_COMBINED_KM, ManeuverInput } from "../lib/maneuver.js";
import { evaluateSafetyGate } from "../lib/safetyGate.js";
import { createProposal, decideProposal, getProposal, listProposals, verifyProposal } from "../lib/proposals.js";
import { assessTasking, baselineTask } from "../lib/tasking.js";
import { requirePermission } from "./authMiddleware.js";

export const api = Router();

function serializeObjectMeta(o: TrackedObject) {
  return { id: o.id, name: o.name, type: o.type, isDesignatedThreat: !!o.isDesignatedThreat };
}

function serializeState(s: StateVector) {
  return { epoch: s.epoch, position: s.position, velocity: s.velocity };
}

function serializeConjunction(c: ConjunctionResult) {
  return {
    tcaOffsetSec: c.tcaOffsetSec,
    tcaIso: c.tcaIso,
    missDistanceKm: c.missDistanceKm,
    relativeVelocityKms: c.relativeVelocityKms,
    collisionProbability: c.collisionProbability,
    risk: c.risk,
    bplane: c.bplane,
    combinedCovariance: c.combinedCovariance,
    hbrKm: c.hbrKm,
    scoring: c.scoring,
    altitudeKm: c.altitudeKm,
    primaryStateAtTca: serializeState(c.primaryStateAtTca),
    secondaryStateAtTca: serializeState(c.secondaryStateAtTca),
  };
}

api.get("/scenario", (_req, res) => {
  const s = buildScenario();
  res.json({
    epoch0Iso: s.epoch0.toISOString(),
    tcaIso: s.tca.toISOString(),
    windowStartSec: s.windowStartSec,
    windowEndSec: s.windowEndSec,
    primary: serializeObjectMeta(s.primary),
    threat: serializeObjectMeta(s.threat),
    nearby: s.nearby.map(serializeObjectMeta),
    disclaimer:
      "DEMO / SIMULATED — all objects, orbits and covariance in this scenario are synthetic prototype data for the ORION hackathon demo.",
  });
});

function findObject(id: string): TrackedObject | undefined {
  const s = buildScenario();
  if (s.primary.id === id) return s.primary;
  if (s.threat.id === id) return s.threat;
  return s.nearby.find((o) => o.id === id);
}

api.get("/trajectory/:objectId", (req, res) => {
  const obj = findObject(req.params.objectId);
  if (!obj) return res.status(404).json({ error: "unknown object id" });
  const start = Number(req.query.startSec ?? 0);
  const end = Number(req.query.endSec ?? buildScenario().windowEndSec);
  const step = Number(req.query.stepSec ?? 60);
  const samples: { t: number; position: number[]; velocity: number[] }[] = [];
  for (let t = start; t <= end + 1e-6; t += step) {
    const st = propagateKeplerian(obj.seedState, t);
    samples.push({ t, position: st.position, velocity: st.velocity });
  }
  res.json({ objectId: obj.id, epoch0Iso: buildScenario().epoch0.toISOString(), samples });
});

api.get("/nearby", (req, res) => {
  const s = buildScenario();
  const atSec = Number(req.query.atSec ?? 0);
  const primaryState = propagateKeplerian(s.primary.seedState, atSec);
  const objects = [s.threat, ...s.nearby].map((o) => {
    const st = propagateKeplerian(o.seedState, atSec);
    const rel = [
      st.position[0] - primaryState.position[0],
      st.position[1] - primaryState.position[1],
      st.position[2] - primaryState.position[2],
    ];
    const relVel = [
      st.velocity[0] - primaryState.velocity[0],
      st.velocity[1] - primaryState.velocity[1],
      st.velocity[2] - primaryState.velocity[2],
    ];
    const distanceKm = Math.sqrt(rel[0] ** 2 + rel[1] ** 2 + rel[2] ** 2);
    const relVelKms = Math.sqrt(relVel[0] ** 2 + relVel[1] ** 2 + relVel[2] ** 2);
    let risk: "SAFE" | "MODERATE" | "HIGH" | "CRITICAL" = "SAFE";
    if (o.isDesignatedThreat) risk = "HIGH";
    else if (distanceKm < 500) risk = "MODERATE";
    return {
      ...serializeObjectMeta(o),
      position: st.position,
      velocity: st.velocity,
      distanceKm,
      relativeVelocityKms: relVelKms,
      risk,
    };
  });
  res.json({ atSec, primary: { ...serializeObjectMeta(s.primary), position: primaryState.position, velocity: primaryState.velocity }, objects });
});

api.get("/conjunction/current", (_req, res) => {
  const s = buildScenario();
  const result = assessConjunction(
    s.primary.seedState,
    s.threat.seedState,
    s.primary.covariance,
    s.threat.covariance,
    HBR_COMBINED_KM,
    s.windowStartSec,
    s.windowEndSec
  );
  res.json({
    primaryId: s.primary.id,
    secondaryId: s.threat.id,
    ...serializeConjunction(result),
    disclaimer: "DEMO / SIMULATED collision probability — synthetic covariance inputs, not an operational CA product.",
  });
});

function parseManeuverInput(body: any): ManeuverInput {
  return {
    burnOffsetSec: Number(body.burnOffsetSec),
    deltaVRadialMs: Number(body.deltaVRadialMs ?? 0),
    deltaVAlongTrackMs: Number(body.deltaVAlongTrackMs ?? 0),
    deltaVCrossTrackMs: Number(body.deltaVCrossTrackMs ?? 0),
  };
}

// Simulating a maneuver is an operator action: the authority reviews the
// operator's numbers, it does not generate its own.
api.post("/maneuver/simulate", requirePermission("maneuver:simulate"), (req, res) => {
  const s = buildScenario();
  const input = parseManeuverInput(req.body ?? {});
  if (!Number.isFinite(input.burnOffsetSec)) {
    return res.status(400).json({ error: "burnOffsetSec is required" });
  }
  const sim = simulateManeuver(s, input);
  const safetyGate = evaluateSafetyGate(sim);
  const samples = sampleOffsetTrajectory(sim.proposedSeed, sim.burnOffsetSec, s.windowEndSec, 60, s.epoch0);
  res.json({
    maneuverInput: input,
    burnOffsetSec: sim.burnOffsetSec,
    burnStateBefore: serializeState(sim.burnStateBefore),
    burnStateAfter: serializeState(sim.burnStateAfter),
    deltaVMagnitudeMs: sim.deltaVMagnitudeMs,
    before: serializeConjunction(sim.before),
    after: serializeConjunction(sim.after),
    proposedSamples: samples,
    safetyGate,
    tasking: assessTasking(s, sim),
    disclaimer: "OPERATOR-PROVIDED MANEUVER — DEMO / SIMULATED trajectory response, not flight-qualified.",
  });
});

/** Baseline task state, before any maneuver has been simulated. */
api.get("/tasking/active", (_req, res) => {
  res.json({
    task: baselineTask(buildScenario()),
    disclaimer: "DEMO / SIMULATED mission tasking data for the ORION prototype.",
  });
});

api.post("/proposals", requirePermission("maneuver:propose"), (req, res) => {
  const input = parseManeuverInput(req.body?.maneuverInput ?? {});
  const operator = req.user?.displayName ?? String(req.body?.operator ?? "Operator");
  const proposal = createProposal(operator, input);
  res.status(201).json(proposal);
});

api.get("/proposals", (_req, res) => {
  res.json(listProposals());
});

api.get("/proposals/:id", (req, res) => {
  const p = getProposal(req.params.id);
  if (!p) return res.status(404).json({ error: "not found" });
  res.json(p);
});

// Deciding a proposal is authority-only — an operator cannot approve their own
// maneuver. Note the route accepts only a decision and a note: the authority
// has no path here to alter the operator's maneuver parameters.
api.post("/proposals/:id/decision", requirePermission("proposal:decide"), (req, res) => {
  const decision = req.body?.decision;
  if (!["APPROVE", "REQUEST_REVISION", "REJECT"].includes(decision)) {
    return res.status(400).json({ error: "invalid decision" });
  }
  const p = decideProposal(req.params.id, decision, req.body?.note, req.user?.displayName);
  if (!p) return res.status(404).json({ error: "not found" });
  res.json(p);
});

api.post("/proposals/:id/verify", requirePermission("proposal:verify"), (req, res) => {
  const p = verifyProposal(req.params.id);
  if (!p) return res.status(400).json({ error: "proposal not approved or not found" });
  res.json(p);
});
