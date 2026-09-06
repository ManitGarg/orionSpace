import React, { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { ConjunctionCurrentResponse } from "../api/types";
import { useAppState } from "../state/AppState";
import { useAuth } from "../state/AuthContext";
import { DemoBadge } from "../components/common/RiskBadge";
import { SafetyGatePanel } from "../components/panels/SafetyGatePanel";
import { RiskCalculationPanel, RiskComparison } from "../components/panels/RiskCalculationPanel";
import { MissionStatusCard, TaskTransferFlow } from "../components/tasking/MissionContinuity";

type Frame = "ALONG_TRACK" | "RADIAL" | "CROSS_TRACK";

export function ManeuverLabPage() {
  const {
    scenario,
    clockSec,
    burnOffsetSec,
    setBurnOffsetSec,
    maneuverResult,
    setManeuverResult,
    setActiveProposal,
    setTrajectoryMode,
  } = useAppState();
  const { user } = useAuth();
  const navigate = useNavigate();

  const [deltaV, setDeltaV] = useState(0.42);
  const [frame, setFrame] = useState<Frame>("ALONG_TRACK");
  const [running, setRunning] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The pre-maneuver conjunction, so the risk calculation is visible *before*
  // the operator commits to any maneuver — this is what justifies the burn.
  const [current, setCurrent] = useState<ConjunctionCurrentResponse | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .conjunctionCurrent()
      .then((c) => !cancelled && setCurrent(c))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const epoch0 = scenario ? new Date(scenario.epoch0Iso) : null;
  const burnClock = epoch0 ? new Date(epoch0.getTime() + burnOffsetSec * 1000) : null;

  const buildInput = () => ({
    burnOffsetSec,
    deltaVRadialMs: frame === "RADIAL" ? deltaV : 0,
    deltaVAlongTrackMs: frame === "ALONG_TRACK" ? deltaV : 0,
    deltaVCrossTrackMs: frame === "CROSS_TRACK" ? deltaV : 0,
  });

  const runSimulation = async () => {
    setRunning(true);
    setError(null);
    try {
      const result = await api.simulateManeuver(buildInput());
      setManeuverResult(result);
      setTrajectoryMode("OVERLAY");
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setRunning(false);
    }
  };

  const submitProposal = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const proposal = await api.createProposal(user?.displayName ?? "Operator", buildInput());
      setActiveProposal(proposal);
      navigate("/proposals");
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setSubmitting(false);
    }
  };

  const before = maneuverResult?.before;
  const after = maneuverResult?.after;
  const tasking = maneuverResult?.tasking;

  return (
    <div className="page">
      <h1>Maneuver Lab</h1>
      <p className="lede">
        Review the numerical risk that justifies a maneuver, enter the burn, and run it through the ORION safety gate
        and mission-continuity check before submitting it for authority review.
      </p>

      {/* 1. WHY IS THE MANEUVER NEEDED? */}
      {current && !maneuverResult && (
        <div className="card">
          <h2>Risk Calculation — Current Conjunction</h2>
          <RiskCalculationPanel conjunction={current} clockSec={clockSec} />
        </div>
      )}

      <div className="card">
        <h2>
          Operator-Provided Maneuver <DemoBadge label="OPERATOR-PROVIDED" />
        </h2>
        <div className="form-grid">
          <div className="form-row">
            <label htmlFor="burn-time">Burn time (offset from window start)</label>
            <input
              id="burn-time"
              type="range"
              min={0}
              max={scenario ? scenario.windowEndSec / 2 : 7200}
              step={60}
              value={burnOffsetSec}
              onChange={(e) => setBurnOffsetSec(Number(e.target.value))}
            />
            <span className="mono" style={{ color: "var(--text-mid)" }}>
              {burnClock ? burnClock.toISOString().slice(11, 16) : "—"} UTC · T+{(burnOffsetSec / 60).toFixed(0)} min
            </span>
          </div>
          <div className="form-row">
            <label htmlFor="delta-v">Δv (m/s)</label>
            <input id="delta-v" type="number" step={0.01} value={deltaV} onChange={(e) => setDeltaV(Number(e.target.value))} />
          </div>
          <div className="form-row">
            <label htmlFor="frame">Direction (maneuver frame)</label>
            <select id="frame" value={frame} onChange={(e) => setFrame(e.target.value as Frame)}>
              <option value="ALONG_TRACK">Along-track</option>
              <option value="RADIAL">Radial</option>
              <option value="CROSS_TRACK">Cross-track</option>
            </select>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={runSimulation} disabled={running}>
            {running ? "Running simulation…" : "▶ RUN SIMULATION"}
          </button>
          <button onClick={() => navigate("/conjunctions")}>View in 3D</button>
        </div>
        {error && <div style={{ color: "var(--risk-critical)", marginTop: 10 }}>{error}</div>}
      </div>

      {before && after && (
        <>
          {/* 1. WHY — the calculation, before and after */}
          <div className="card">
            <h2>Risk Calculation — Before vs. After Maneuver</h2>
            <RiskComparison before={before} after={after} />
            <div className="calc-note" style={{ marginTop: 12 }}>
              Δv magnitude {maneuverResult!.deltaVMagnitudeMs.toFixed(3)} m/s · {maneuverResult!.disclaimer}
            </div>
          </div>

          <div className="card">
            <h2>Post-Maneuver Risk Calculation</h2>
            <RiskCalculationPanel conjunction={after} clockSec={clockSec} title="After maneuver" />
          </div>

          {/* 2. WHAT HAPPENS TO SAT-A'S MISSION? */}
          {tasking && (
            <div className="card">
              <h2>Mission Impact &amp; Task Continuity</h2>
              <MissionStatusCard tasking={tasking} />
              <div style={{ marginTop: 16 }}>
                <TaskTransferFlow tasking={tasking} />
              </div>
              <div style={{ marginTop: 14 }}>
                <Link to="/mission-continuity">
                  <button>Open full mission continuity analysis</button>
                </Link>
              </div>
            </div>
          )}

          <div className="card">
            <h2>ORION Safety Gate</h2>
            <SafetyGatePanel gate={maneuverResult!.safetyGate} />
            <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
              <button onClick={submitProposal} disabled={submitting || maneuverResult!.safetyGate.overall === "BLOCKED"}>
                {submitting ? "Submitting…" : "SUBMIT PROPOSAL TO AUTHORITY"}
              </button>
              <button onClick={() => { setTrajectoryMode("OVERLAY"); navigate("/conjunctions"); }}>
                Show overlay in 3D
              </button>
            </div>
            {maneuverResult!.safetyGate.overall === "BLOCKED" && (
              <div style={{ marginTop: 10, color: "var(--risk-critical)", fontSize: 12 }}>
                Submission disabled — resolve the blocking condition above first.
              </div>
            )}
            <div className="calc-note" style={{ marginTop: 10 }}>
              The operator submits the proposal for review. Approval and rejection are authority actions — an operator
              cannot approve their own maneuver.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
