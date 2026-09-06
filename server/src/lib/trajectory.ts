import { sampleTrajectory, StateVector } from "./kepler.js";

export interface OffsetSample {
  t: number;
  position: [number, number, number];
  velocity: [number, number, number];
}

/** Sample a seed state's trajectory, expressing each sample's time as an offset (sec) from `epoch0`. */
export function sampleOffsetTrajectory(
  seed: StateVector,
  startSec: number,
  endSec: number,
  stepSec: number,
  epoch0: Date
): OffsetSample[] {
  return sampleTrajectory(seed, startSec, endSec, stepSec).map((st) => ({
    t: (st.epoch - epoch0.getTime()) / 1000,
    position: st.position,
    velocity: st.velocity,
  }));
}
