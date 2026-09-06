import React from "react";
import type { MissionTask, TaskingAssessment } from "../../api/types";
import { DemoBadge } from "../common/RiskBadge";

const STATUS_LABEL: Record<MissionTask["status"], string> = {
  IN_PROGRESS: "IN PROGRESS",
  NO_LONGER_FEASIBLE: "NO LONGER FEASIBLE",
  REASSIGNED: "REASSIGNED",
  AT_RISK: "AT RISK",
};

function fmtClock(iso: string): string {
  return new Date(iso).toISOString().slice(11, 16);
}

function fmtOffset(sec: number): string {
  return `T+${(sec / 60).toFixed(0)} min`;
}

/**
 * The task as it stands, with or without a simulated maneuver. When the task
 * has been reassigned, the original and current assignments are shown as
 * separate rows — "assigned: SAT-A / status: REASSIGNED" on its own reads as a
 * contradiction.
 */
export function ActiveTaskCard({ task, currentSatellite }: { task: MissionTask; currentSatellite?: string | null }) {
  const reassigned = !!currentSatellite && currentSatellite !== task.assignedSatellite;
  return (
    <div>
      <div className="kv-row"><span className="k">Task ID</span><span className="v">{task.taskId}</span></div>
      <div className="kv-row"><span className="k">Mission</span><span className="v">{task.mission}</span></div>
      <div className="kv-row"><span className="k">Target</span><span className="v">{task.target}</span></div>
      <div className="kv-row">
        <span className="k">Target location</span>
        <span className="v">{task.targetLatDeg.toFixed(2)}°, {task.targetLonDeg.toFixed(2)}°</span>
      </div>
      <div className="kv-row"><span className="k">Priority</span><span className="v">{task.priority}</span></div>
      <div className="kv-row"><span className="k">Deadline</span><span className="v">{task.deadlineMinutes} minutes</span></div>
      <div className="kv-row"><span className="k">Imaging window</span><span className="v">{fmtOffset(task.nominalAccessOffsetSec)}</span></div>
      <div className="kv-row">
        <span className="k">{reassigned ? "Original assigned satellite" : "Assigned satellite"}</span>
        <span className="v">{task.assignedSatellite}</span>
      </div>
      {reassigned && (
        <div className="kv-row">
          <span className="k">Currently assigned</span>
          <span className="v" style={{ color: "var(--good)" }}>{currentSatellite}</span>
        </div>
      )}
      <div className="kv-row">
        <span className="k">Status</span>
        <span
          className="v"
          style={{
            color:
              task.status === "REASSIGNED"
                ? "var(--good)"
                : task.status === "AT_RISK" || task.status === "NO_LONGER_FEASIBLE"
                ? "var(--risk-high)"
                : undefined,
          }}
        >
          {STATUS_LABEL[task.status]}
        </span>
      </div>
    </div>
  );
}

/** Why the maneuver did (or did not) invalidate SAT-A's imaging opportunity. */
export function MissionImpactCard({ tasking }: { tasking: TaskingAssessment }) {
  const { impact } = tasking;
  const lost = !impact.stillFeasible;

  return (
    <div>
      <div
        className="gate-banner"
        style={{
          background: lost ? "rgba(224,145,60,0.12)" : "rgba(87,209,154,0.12)",
          border: `1px solid ${lost ? "rgba(224,145,60,0.4)" : "rgba(87,209,154,0.4)"}`,
          color: lost ? "var(--risk-high)" : "var(--good)",
          marginBottom: 14,
        }}
      >
        {lost ? "MISSION IMPACT DETECTED" : "NO MISSION IMPACT"}
      </div>

      <div className="kv-row">
        <span className="k">Attitude outage (burn)</span>
        <span className="v">
          {fmtOffset(impact.outageStartSec)} → {fmtOffset(impact.outageEndSec)} ({impact.outageMinutes.toFixed(0)} min)
        </span>
      </div>
      <div className="kv-row">
        <span className="k">Target access window</span>
        <span className="v">{fmtOffset(impact.nominalAccessOffsetSec)}</span>
      </div>
      <div className="kv-row">
        <span className="k">Access inside outage</span>
        <span className="v" style={{ color: impact.accessInsideOutage ? "var(--risk-high)" : "var(--good)" }}>
          {impact.accessInsideOutage ? "YES" : "NO"}
        </span>
      </div>
      <div className="kv-row">
        <span className="k">Post-maneuver ground range</span>
        <span className="v">
          {impact.postManeuverGroundRangeKm.toFixed(1)} km / {impact.sensorSwathKm} km swath
        </span>
      </div>
      <div className="kv-row">
        <span className="k">Arrival shift</span>
        <span className="v">{impact.arrivalShiftSec >= 0 ? "+" : ""}{impact.arrivalShiftSec.toFixed(0)} s</span>
      </div>
      <div className="kv-row">
        <span className="k">Task feasibility</span>
        <span className="v" style={{ color: lost ? "var(--risk-high)" : "var(--good)" }}>
          {lost ? "NO LONGER FEASIBLE" : "VALID"}
        </span>
      </div>

      <div className="calc-note" style={{ marginTop: 12 }}>
        <strong style={{ color: "var(--text-mid)" }}>Reason: </strong>
        {impact.reason}
      </div>
    </div>
  );
}

/** The SAT-A → SAT-B story, as an at-a-glance vertical flow. */
export function TaskTransferFlow({ tasking }: { tasking: TaskingAssessment }) {
  const lost = !tasking.impact.stillFeasible;
  const target = tasking.selectedSatellite;

  return (
    <div className="transfer-flow">
      <div className="transfer-node sat-a">
        <div className="node-title">SAT-A</div>
        <div className="node-sub">Original task assignment — {tasking.task.taskId}</div>
      </div>
      <div className="transfer-arrow">↓</div>
      <div className="transfer-node event">
        <div className="node-title">COLLISION AVOIDANCE MANEUVER</div>
        <div className="node-sub">Executed to resolve the high-risk conjunction</div>
      </div>
      <div className="transfer-arrow">↓</div>
      <div className="transfer-node event">
        <div className="node-title">TASK IMPACT ANALYSIS</div>
        <div className="node-sub">Imaging window re-evaluated against the new trajectory</div>
      </div>
      <div className="transfer-arrow">↓</div>

      {!lost ? (
        <>
          <div className="transfer-node sat-a">
            <div className="node-title">TASK STILL FEASIBLE</div>
            <div className="node-sub">SAT-A retains the imaging opportunity</div>
          </div>
          <div className="transfer-arrow">↓</div>
          <div className="transfer-node preserved">
            <div className="node-title">MISSION PRESERVED</div>
            <div className="node-sub">No reassignment required</div>
          </div>
        </>
      ) : (
        <>
          <div className="transfer-node lost">
            <div className="node-title">ORIGINAL TASK NO LONGER FEASIBLE</div>
            <div className="node-sub">SAT-A cannot service the imaging window</div>
          </div>
          <div className="transfer-arrow">↓</div>
          {target ? (
            <>
              <div className="transfer-node sat-b">
                <div className="node-title">{target}</div>
                <div className="node-sub">TASK REASSIGNED</div>
              </div>
              <div className="transfer-arrow">↓</div>
              <div className="transfer-node preserved">
                <div className="node-title">MISSION PRESERVED</div>
                <div className="node-sub">{tasking.task.taskId} continues on {target}</div>
              </div>
            </>
          ) : (
            <div className="transfer-node lost">
              <div className="node-title">NO REPLACEMENT AVAILABLE</div>
              <div className="node-sub">MISSION AT RISK</div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** Fleet screening: who could take the task, and why the winner won. */
export function CandidateTable({ tasking }: { tasking: TaskingAssessment }) {
  return (
    <table className="candidate-table">
      <thead>
        <tr>
          <th>Satellite</th>
          <th>Available</th>
          <th>Collision risk</th>
          <th>Sensor</th>
          <th>Time to target</th>
          <th>Within deadline</th>
          <th>Feasibility</th>
        </tr>
      </thead>
      <tbody>
        {tasking.candidates.map((c) => (
          <tr key={c.satelliteId} className={tasking.selectedSatellite === c.satelliteId ? "selected" : ""}>
            <td style={{ fontWeight: 600 }}>
              {c.satelliteId}
              {tasking.selectedSatellite === c.satelliteId && (
                <span style={{ color: "var(--good)", marginLeft: 6, fontSize: 10 }}>SELECTED</span>
              )}
            </td>
            <td className={c.available ? "yes" : "no"}>{c.available ? "AVAILABLE" : "UNAVAILABLE"}</td>
            <td className={c.collisionRisk === "ACCEPTABLE" ? "yes" : "no"}>{c.collisionRisk}</td>
            <td className={c.sensorCompatible ? "yes" : "no"}>{c.sensorCompatible ? "COMPATIBLE" : "INCOMPATIBLE"}</td>
            <td>{c.timeToTargetMinutes} min</td>
            <td className={c.withinDeadline ? "yes" : "no"}>{c.withinDeadline ? "YES" : "NO"}</td>
            <td className={c.feasible ? "yes" : "no"}>{c.feasible ? "VALID" : "REJECTED"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ReassignmentSummary({ tasking }: { tasking: TaskingAssessment }) {
  if (!tasking.selectedSatellite) return null;
  const selected = tasking.candidates.find((c) => c.satelliteId === tasking.selectedSatellite);
  return (
    <div>
      <div className="kv-row"><span className="k">Previous satellite</span><span className="v">{tasking.task.assignedSatellite}</span></div>
      <div className="kv-row"><span className="k">New satellite</span><span className="v" style={{ color: "var(--good)" }}>{tasking.selectedSatellite}</span></div>
      {selected && (
        <>
          <div className="kv-row"><span className="k">Availability</span><span className="v">{selected.available ? "AVAILABLE" : "UNAVAILABLE"}</span></div>
          <div className="kv-row"><span className="k">Collision risk</span><span className="v">{selected.collisionRisk}</span></div>
          <div className="kv-row"><span className="k">Time to target</span><span className="v">{selected.timeToTargetMinutes} minutes</span></div>
          <div className="kv-row"><span className="k">Mission deadline</span><span className="v">{tasking.task.deadlineMinutes} minutes</span></div>
          <div className="kv-row"><span className="k">Task feasibility</span><span className="v" style={{ color: "var(--good)" }}>VALID</span></div>
        </>
      )}
      <div className="calc-note" style={{ marginTop: 10 }}>
        <strong style={{ color: "var(--text-mid)" }}>Reason for reassignment: </strong>
        {tasking.impact.reason}
      </div>
    </div>
  );
}

export function TaskTimeline({ tasking }: { tasking: TaskingAssessment }) {
  return (
    <div className="event-timeline">
      {tasking.timeline.map((e, i) => {
        const highlight = e.label.includes("MISSION PRESERVED") || e.label.includes("MISSION AT RISK");
        return (
          <div key={`${e.at}-${i}`} className={`event-row ${highlight ? "highlight" : ""}`}>
            <span className="t">{fmtClock(e.at)}</span>
            <span className="lbl">{e.label}</span>
          </div>
        );
      })}
    </div>
  );
}

export function MissionStatusCard({ tasking }: { tasking: TaskingAssessment }) {
  return (
    <div className={`mission-status ${tasking.outcome}`}>
      <div className="headline">{tasking.outcome === "PRESERVED" ? "MISSION PRESERVED" : "MISSION AT RISK"}</div>
      <div className="detail">{tasking.outcomeDetail}</div>
      <div style={{ marginTop: 4 }}>
        <DemoBadge />
      </div>
    </div>
  );
}
