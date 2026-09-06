import { StateVector, propagateKeplerian, applyManeuverDeltaV } from "./kepler.js";
import { assessConjunction, ConjunctionResult } from "./conjunction.js";
import { Scenario } from "./scenario.js";

export interface ManeuverInput {
  /** seconds offset from scenario epoch0 */
  burnOffsetSec: number;
  /** m/s, operator-provided, converted internally to km/s */
  deltaVRadialMs: number;
  deltaVAlongTrackMs: number;
  deltaVCrossTrackMs: number;
}

export interface ManeuverSimulationResult {
  burnOffsetSec: number;
  burnStateBefore: StateVector;
  burnStateAfter: StateVector;
  /** seed state such that propagateKeplerian(proposedSeed, t) gives the proposed trajectory at offset t */
  proposedSeed: StateVector;
  deltaVMagnitudeMs: number;
  before: ConjunctionResult;
  after: ConjunctionResult;
}

const HBR_COMBINED_KM = 0.22; // combined hard-body radius, km (synthetic, tuned for demo drama)

export function simulateManeuver(scenario: Scenario, input: ManeuverInput): ManeuverSimulationResult {
  const { primary, threat, windowStartSec, windowEndSec } = scenario;

  const before = assessConjunction(
    primary.seedState,
    threat.seedState,
    primary.covariance,
    threat.covariance,
    HBR_COMBINED_KM,
    windowStartSec,
    windowEndSec,
    threat.massKg
  );

  const burnStateBefore = propagateKeplerian(primary.seedState, input.burnOffsetSec);
  const burnStateAfter = applyManeuverDeltaV(burnStateBefore, {
    radial: input.deltaVRadialMs / 1000,
    alongTrack: input.deltaVAlongTrackMs / 1000,
    crossTrack: input.deltaVCrossTrackMs / 1000,
  });

  // re-anchor: build a "seed" for the proposed trajectory such that
  // propagateKeplerian(proposedSeed, t) reproduces burnStateAfter at t=burnOffsetSec
  const proposedSeed = propagateKeplerian(burnStateAfter, -input.burnOffsetSec);

  const after = assessConjunction(
    proposedSeed,
    threat.seedState,
    primary.covariance,
    threat.covariance,
    HBR_COMBINED_KM,
    input.burnOffsetSec,
    windowEndSec,
    threat.massKg
  );

  const deltaVMagnitudeMs = Math.sqrt(
    input.deltaVRadialMs ** 2 + input.deltaVAlongTrackMs ** 2 + input.deltaVCrossTrackMs ** 2
  );

  return {
    burnOffsetSec: input.burnOffsetSec,
    burnStateBefore,
    burnStateAfter,
    proposedSeed,
    deltaVMagnitudeMs,
    before,
    after,
  };
}

export { HBR_COMBINED_KM };
