import React from "react";
import { useAppState, PlaybackSpeed } from "../../state/AppState";
import { formatDuration } from "../../lib/orbit";

const SPEEDS: PlaybackSpeed[] = [0.5, 1, 5, 10, 50];

export function SimulationTimeline({ windowEndSec, tcaOffsetSec }: { windowEndSec: number; tcaOffsetSec: number }) {
  const {
    clockSec,
    setClockSec,
    playing,
    setPlaying,
    speed,
    setSpeed,
    reset,
    jumpToTCA,
    jumpToBurn,
    jumpToPostBurn,
    burnOffsetSec,
  } = useAppState();

  const pct = (v: number) => `${Math.min(100, Math.max(0, (v / windowEndSec) * 100))}%`;

  return (
    <div className="timeline-bar">
      <div className="timeline-controls">
        <button onClick={() => setPlaying(!playing)}>{playing ? "⏸ PAUSE" : "▶ PLAY"}</button>
        <button onClick={reset}>↻ RESET</button>
        <button onClick={jumpToBurn}>BURN</button>
        <button onClick={jumpToTCA}>TCA</button>
        <button onClick={jumpToPostBurn}>POST-BURN</button>

        <div className="timeline-track">
          <div className="timeline-marker" style={{ left: "0%" }}>
            <span className="timeline-marker-label" style={{ left: 0, transform: "none" }}>T-2h</span>
          </div>
          <div className="timeline-marker" style={{ left: "25%" }}>
            <span className="timeline-marker-label">T-1h</span>
          </div>
          <div className="timeline-marker burn" style={{ left: pct(burnOffsetSec) }}>
            <span className="timeline-marker-label" style={{ color: "var(--accent)" }}>BURN</span>
          </div>
          <div className="timeline-marker tca" style={{ left: pct(tcaOffsetSec) }}>
            <span className="timeline-marker-label" style={{ color: "var(--risk-critical)" }}>TCA</span>
          </div>
          <div className="timeline-marker" style={{ left: "100%" }}>
            <span className="timeline-marker-label" style={{ left: "auto", right: 0, transform: "none" }}>+2h</span>
          </div>
          <div className="timeline-playhead" style={{ left: pct(clockSec) }} />
          <input
            className="timeline-range"
            type="range"
            min={0}
            max={windowEndSec}
            step={1}
            value={clockSec}
            onChange={(e) => setClockSec(Number(e.target.value))}
          />
        </div>

        <span className="mono" style={{ width: 70, textAlign: "right", color: "var(--text-mid)" }}>
          {formatDuration(clockSec - tcaOffsetSec)}
        </span>

        <div className="speed-select">
          {SPEEDS.map((s) => (
            <button key={s} className={speed === s ? "active" : ""} onClick={() => setSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
      </div>
      <div className="timeline-labels">
        <span>T-2h</span>
        <span>T-1h</span>
        <span>BURN</span>
        <span>TCA</span>
        <span>+2h</span>
      </div>
    </div>
  );
}
