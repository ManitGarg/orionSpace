import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api/client";
import type { MissionTask } from "../api/types";
import { useAppState } from "../state/AppState";
import { useAuth } from "../state/AuthContext";
import { DemoBadge } from "../components/common/RiskBadge";
import {
  ActiveTaskCard,
  CandidateTable,
  MissionImpactCard,
  MissionStatusCard,
  ReassignmentSummary,
  TaskTimeline,
  TaskTransferFlow,
} from "../components/tasking/MissionContinuity";

/**
 * Mission continuity. Before a maneuver has been simulated this shows the
 * standing task; afterwards it shows the impact of that specific maneuver and,
 * where needed, the re-tasking that preserves the mission.
 */
export function MissionContinuityPage() {
  const { maneuverResult, activeProposal } = useAppState();
  const { user } = useAuth();
  const [baseline, setBaseline] = useState<MissionTask | null>(null);

  // The tasking assessment comes from whichever maneuver is in play: the one
  // the operator just simulated, or the one attached to the proposal an
  // authority is reviewing.
  const tasking = maneuverResult?.tasking ?? activeProposal?.tasking ?? null;

  useEffect(() => {
    if (tasking) return;
    let cancelled = false;
    api
      .activeTask()
      .then((r) => !cancelled && setBaseline(r.task))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [tasking]);

  const task = tasking?.task ?? baseline;

  return (
    <div className="page">
      <h1>Mission Continuity &amp; Task Reassignment</h1>
      <p className="lede">
        A collision-avoidance maneuver keeps the spacecraft safe — but it can cost the mission. ORION re-evaluates the
        active tasking against the new trajectory and, if the original satellite can no longer service it, reassigns
        the task automatically. <DemoBadge />
      </p>

      <div className="card">
        <h2>Active Mission Task</h2>
        {task ? (
          <ActiveTaskCard task={task} currentSatellite={tasking?.selectedSatellite} />
        ) : (
          <div className="empty-hint">Loading active task…</div>
        )}
      </div>

      {!tasking && (
        <div className="card">
          <h2>Awaiting maneuver simulation</h2>
          <div className="empty-hint">
            No maneuver has been simulated yet, so the task is unaffected and still assigned to{" "}
            {task?.assignedSatellite ?? "SAT-A"}.{" "}
            {user?.role === "OPERATOR" ? (
              <>
                Run a simulation in the <Link to="/maneuver-lab">Maneuver Lab</Link> to see its effect on this task.
              </>
            ) : (
              <>
                Select a submitted proposal in the <Link to="/proposals">Authority Console</Link> to review the mission
                impact the operator recorded.
              </>
            )}
          </div>
        </div>
      )}

      {tasking && (
        <>
          <div className="card">
            <h2>Mission Impact Analysis</h2>
            <MissionImpactCard tasking={tasking} />
          </div>

          <div className="card">
            <h2>Task Transfer</h2>
            <TaskTransferFlow tasking={tasking} />
          </div>

          {tasking.selectedSatellite && (
            <div className="card">
              <h2>Automatic Re-Tasking</h2>
              <ReassignmentSummary tasking={tasking} />
            </div>
          )}

          <div className="card">
            <h2>Fleet Screening</h2>
            <CandidateTable tasking={tasking} />
            <div className="calc-note" style={{ marginTop: 10 }}>{tasking.disclaimer}</div>
          </div>

          <div className="card">
            <h2>Task Reassignment History</h2>
            <TaskTimeline tasking={tasking} />
          </div>

          <div className="card">
            <h2>Mission Status</h2>
            <MissionStatusCard tasking={tasking} />
          </div>
        </>
      )}
    </div>
  );
}
