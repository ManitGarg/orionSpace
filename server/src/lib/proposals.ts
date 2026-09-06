import { randomUUID } from "node:crypto";
import { ManeuverInput, ManeuverSimulationResult, simulateManeuver } from "./maneuver.js";
import { evaluateSafetyGate, SafetyGateResult } from "./safetyGate.js";
import { buildScenario } from "./scenario.js";
import { assessConjunction, ConjunctionResult } from "./conjunction.js";
import { HBR_COMBINED_KM } from "./maneuver.js";
import { OffsetSample, sampleOffsetTrajectory } from "./trajectory.js";
import { assessTasking, TaskingAssessment } from "./tasking.js";

export type ProposalStatus =
  | "PENDING_AUTHORITY"
  | "APPROVED"
  | "REVISION_REQUESTED"
  | "REJECTED"
  | "VERIFIED";

export interface Proposal {
  id: string;
  createdAt: string;
  operator: string;
  status: ProposalStatus;
  maneuverInput: ManeuverInput;
  simulation: ManeuverSimulationResult;
  proposedSamples: OffsetSample[];
  safetyGate: SafetyGateResult;
  /** mission-continuity assessment captured at submission, so the authority reviews what the operator saw */
  tasking: TaskingAssessment;
  authorityNote?: string;
  decidedBy?: string;
  decidedAt?: string;
  verification?: {
    verifiedConjunction: ConjunctionResult;
    verifiedSamples: OffsetSample[];
    secondaryConjunctionsFound: number;
    resolvedAt: string;
  };
}

const store = new Map<string, Proposal>();

export function createProposal(operator: string, maneuverInput: ManeuverInput): Proposal {
  const scenario = buildScenario();
  const simulation = simulateManeuver(scenario, maneuverInput);
  const safetyGate = evaluateSafetyGate(simulation);
  const proposedSamples = sampleOffsetTrajectory(
    simulation.proposedSeed,
    simulation.burnOffsetSec,
    scenario.windowEndSec,
    60,
    scenario.epoch0
  );
  const proposal: Proposal = {
    id: randomUUID(),
    createdAt: new Date().toISOString(),
    operator,
    status: "PENDING_AUTHORITY",
    maneuverInput,
    simulation,
    proposedSamples,
    safetyGate,
    tasking: assessTasking(scenario, simulation),
  };
  store.set(proposal.id, proposal);
  return proposal;
}

export function listProposals(): Proposal[] {
  return Array.from(store.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

export function getProposal(id: string): Proposal | undefined {
  return store.get(id);
}

export function decideProposal(
  id: string,
  decision: "APPROVE" | "REQUEST_REVISION" | "REJECT",
  note?: string,
  decidedBy?: string
): Proposal | undefined {
  const p = store.get(id);
  if (!p) return undefined;
  p.status =
    decision === "APPROVE" ? "APPROVED" : decision === "REJECT" ? "REJECTED" : "REVISION_REQUESTED";
  p.authorityNote = note;
  p.decidedBy = decidedBy;
  p.decidedAt = new Date().toISOString();
  return p;
}

/**
 * Post-approval verification: re-propagate the executed (verified) orbit,
 * re-run conjunction screening against the threat AND the rest of the
 * tracked field ("secondary screening"), and report the resolved outcome.
 * A small simulated execution error is applied to the Δv to distinguish the
 * "verified" trajectory from the purely predicted "proposed" one.
 */
export function verifyProposal(id: string): Proposal | undefined {
  const p = store.get(id);
  if (!p || p.status !== "APPROVED") return undefined;
  const scenario = buildScenario();

  const executionErrorFactor = 1 + (Math.random() * 0.06 - 0.03); // ±3% execution error
  const verifiedInput = {
    ...p.maneuverInput,
    deltaVRadialMs: p.maneuverInput.deltaVRadialMs * executionErrorFactor,
    deltaVAlongTrackMs: p.maneuverInput.deltaVAlongTrackMs * executionErrorFactor,
    deltaVCrossTrackMs: p.maneuverInput.deltaVCrossTrackMs * executionErrorFactor,
  };
  const verifiedSim = simulateManeuver(scenario, verifiedInput);

  let secondaryConjunctionsFound = 0;
  for (const obj of scenario.nearby) {
    const r = assessConjunction(
      scenario.primary.seedState,
      obj.seedState,
      scenario.primary.covariance,
      obj.covariance,
      HBR_COMBINED_KM,
      p.maneuverInput.burnOffsetSec,
      scenario.windowEndSec
    );
    if (r.risk === "HIGH" || r.risk === "CRITICAL") secondaryConjunctionsFound += 1;
  }

  const verifiedSamples = sampleOffsetTrajectory(
    verifiedSim.proposedSeed,
    verifiedSim.burnOffsetSec,
    scenario.windowEndSec,
    60,
    scenario.epoch0
  );

  p.verification = {
    verifiedConjunction: verifiedSim.after,
    verifiedSamples,
    secondaryConjunctionsFound,
    resolvedAt: new Date().toISOString(),
  };
  p.status = "VERIFIED";
  return p;
}
