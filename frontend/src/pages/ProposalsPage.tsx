import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../api/client";
import type { Proposal } from "../api/types";
import { useAppState } from "../state/AppState";
import { useAuth } from "../state/AuthContext";
import { DemoBadge, RiskBadge } from "../components/common/RiskBadge";
import { SafetyGatePanel } from "../components/panels/SafetyGatePanel";
import { RiskComparison } from "../components/panels/RiskCalculationPanel";
import {
  CandidateTable,
  MissionImpactCard,
  MissionStatusCard,
  TaskTransferFlow,
  TaskTimeline,
} from "../components/tasking/MissionContinuity";
import { formatPc } from "../lib/orbit";

export function ProposalsPage() {
  const { activeProposal, setActiveProposal, setTrajectoryMode } = useAppState();
  const { user, can } = useAuth();
  const navigate = useNavigate();
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState("");

  const isAuthority = user?.role === "AUTHORITY";

  const refresh = async () => {
    const list = await api.listProposals();
    setProposals(list);
    setActiveProposal((prev: Proposal | null) => {
      if (!prev) return prev;
      return list.find((p) => p.id === prev.id) ?? prev;
    });
  };

  useEffect(() => {
    refresh().catch((e) => setError(String(e?.message ?? e)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selected = activeProposal;

  const decide = async (decision: "APPROVE" | "REQUEST_REVISION" | "REJECT") => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.decideProposal(selected.id, decision, note || undefined);
      setActiveProposal(updated);
      await refresh();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const runVerification = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const updated = await api.verifyProposal(selected.id);
      setActiveProposal(updated);
      setTrajectoryMode("VERIFIED");
      await refresh();
    } catch (e: any) {
      setError(String(e?.message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page">
      <h1>{isAuthority ? "Authority Console — Maneuver Proposals" : "Submitted Proposals"}</h1>
      <p className="lede">
        {isAuthority ? (
          <>
            Review the same conjunction, geometry, risk calculation, mission impact and safety gate the operator saw,
            then approve, request revision, or reject. The maneuver parameters are read-only here — revisions go back
            to the operator.
          </>
        ) : (
          <>
            Proposals you have submitted for authority review. Approval decisions are made by the authority — you
            cannot approve your own maneuver.
          </>
        )}{" "}
        <DemoBadge />
      </p>

      {error && (
        <div className="card" style={{ borderColor: "rgba(226,80,63,0.4)" }}>
          <div style={{ color: "var(--risk-critical)" }}>{error}</div>
        </div>
      )}

      <div className="card">
        <h2>Proposals</h2>
        {proposals.length === 0 && <div className="empty-hint">No proposals submitted yet.</div>}
        {proposals.map((p) => (
          <div
            key={p.id}
            className={`proposal-row ${selected?.id === p.id ? "selected" : ""}`}
            onClick={() => setActiveProposal(p)}
          >
            <div>
              <div style={{ fontWeight: 600 }}>
                Δv {p.simulation.deltaVMagnitudeMs.toFixed(2)} m/s · burn T+{(p.maneuverInput.burnOffsetSec / 60).toFixed(0)} min
              </div>
              <div style={{ color: "var(--text-low)", fontSize: 11 }}>
                {p.operator} · {new Date(p.createdAt).toISOString().replace("T", " ").slice(0, 19)} UTC
                {p.tasking && ` · mission ${p.tasking.outcome === "PRESERVED" ? "preserved" : "at risk"}`}
              </div>
            </div>
            <span className="status-pill">{p.status.replace(/_/g, " ")}</span>
          </div>
        ))}
      </div>

      {selected && (
        <>
          <div className="card">
            <h2>Risk Calculation — Operator Submission</h2>
            <RiskComparison before={selected.simulation.before} after={selected.simulation.after} />
            <button style={{ marginTop: 12 }} onClick={() => { setTrajectoryMode("OVERLAY"); navigate("/conjunctions"); }}>
              Inspect 3D geometry
            </button>
          </div>

          <div className="card">
            <h2>Operator Calculation</h2>
            <div className="kv-row"><span className="k">Submitted by</span><span className="v">{selected.operator}</span></div>
            <div className="kv-row"><span className="k">Burn offset</span><span className="v">T+{(selected.maneuverInput.burnOffsetSec / 60).toFixed(0)} min</span></div>
            <div className="kv-row"><span className="k">Δv radial</span><span className="v">{selected.maneuverInput.deltaVRadialMs.toFixed(3)} m/s</span></div>
            <div className="kv-row"><span className="k">Δv along-track</span><span className="v">{selected.maneuverInput.deltaVAlongTrackMs.toFixed(3)} m/s</span></div>
            <div className="kv-row"><span className="k">Δv cross-track</span><span className="v">{selected.maneuverInput.deltaVCrossTrackMs.toFixed(3)} m/s</span></div>
            <div className="calc-note" style={{ marginTop: 10 }}>
              Maneuver parameters are shown read-only. The authority approves, requests revision, or rejects — it does
              not edit the operator's maneuver.
            </div>
          </div>

          {selected.tasking && (
            <>
              <div className="card">
                <h2>Mission Impact &amp; Task Reassignment</h2>
                <MissionStatusCard tasking={selected.tasking} />
                <div style={{ marginTop: 16 }}>
                  <MissionImpactCard tasking={selected.tasking} />
                </div>
                <div style={{ marginTop: 18 }}>
                  <TaskTransferFlow tasking={selected.tasking} />
                </div>
              </div>

              <div className="card">
                <h2>Fleet Screening</h2>
                <CandidateTable tasking={selected.tasking} />
              </div>

              <div className="card">
                <h2>Task Reassignment History</h2>
                <TaskTimeline tasking={selected.tasking} />
              </div>
            </>
          )}

          <div className="card">
            <h2>ORION Safety Gate</h2>
            <SafetyGatePanel gate={selected.safetyGate} />
          </div>

          {selected.status === "PENDING_AUTHORITY" && isAuthority && can("proposal:decide") && (
            <div className="card">
              <h2>Authority Decision</h2>
              <div className="form-row">
                <label htmlFor="decision-note">Note (optional)</label>
                <input
                  id="decision-note"
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Rationale for the decision"
                />
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={() => decide("APPROVE")} disabled={busy}>APPROVE</button>
                <button onClick={() => decide("REQUEST_REVISION")} disabled={busy}>REQUEST REVISION</button>
                <button onClick={() => decide("REJECT")} disabled={busy}>REJECT</button>
              </div>
              <div className="calc-note" style={{ marginTop: 10 }}>
                Simulated authority workflow. ORION does not grant official authority approval or command spacecraft.
              </div>
            </div>
          )}

          {selected.status === "PENDING_AUTHORITY" && !isAuthority && (
            <div className="card">
              <h2>Awaiting Authority Review</h2>
              <div className="empty-hint">
                This proposal is pending review. Approve, request revision and reject are authority actions — an
                operator cannot approve their own maneuver proposal.
              </div>
            </div>
          )}

          {selected.decidedAt && (
            <div className="card">
              <h2>Decision</h2>
              <div className="kv-row"><span className="k">Status</span><span className="v">{selected.status.replace(/_/g, " ")}</span></div>
              {selected.decidedBy && <div className="kv-row"><span className="k">Decided by</span><span className="v">{selected.decidedBy}</span></div>}
              <div className="kv-row"><span className="k">Decided at</span><span className="v">{new Date(selected.decidedAt).toISOString().replace("T", " ").slice(0, 19)} UTC</span></div>
              {selected.authorityNote && <div className="kv-row"><span className="k">Note</span><span className="v">{selected.authorityNote}</span></div>}
            </div>
          )}

          {selected.status === "APPROVED" && isAuthority && (
            <div className="card">
              <h2>Post-Maneuver Verification</h2>
              <p style={{ color: "var(--text-mid)" }}>
                Propagate the executed orbit (with simulated execution error), re-run conjunction screening, recompute
                risk, and check for secondary conjunctions.
              </p>
              <button onClick={runVerification} disabled={busy}>
                {busy ? "Verifying…" : "RUN VERIFICATION"}
              </button>
            </div>
          )}

          {selected.verification && (
            <div className="card">
              <h2>Event Resolved</h2>
              <div className="gate-banner CLEARED" style={{ marginBottom: 14 }}>EVENT RESOLVED</div>
              <div className="kv-row"><span className="k">Original miss distance</span><span className="v">{selected.simulation.before.missDistanceKm.toFixed(2)} km</span></div>
              <div className="kv-row"><span className="k">Verified miss distance</span><span className="v">{selected.verification.verifiedConjunction.missDistanceKm.toFixed(2)} km</span></div>
              <div className="kv-row"><span className="k">Original Pc</span><span className="v">{formatPc(selected.simulation.before.collisionProbability)}</span></div>
              <div className="kv-row"><span className="k">Verified Pc</span><span className="v">{formatPc(selected.verification.verifiedConjunction.collisionProbability)}</span></div>
              <div className="kv-row"><span className="k">Original risk score</span><span className="v">{selected.simulation.before.scoring.riskScore.toFixed(4)}</span></div>
              <div className="kv-row"><span className="k">Verified risk score</span><span className="v">{selected.verification.verifiedConjunction.scoring.riskScore.toExponential(2)}</span></div>
              <div className="kv-row"><span className="k">Secondary conjunctions</span><span className="v">{selected.verification.secondaryConjunctionsFound}</span></div>
              <div className="kv-row" style={{ alignItems: "center" }}>
                <span className="k">Verified risk</span>
                <RiskBadge risk={selected.verification.verifiedConjunction.risk} />
              </div>
              {selected.tasking && (
                <div className="kv-row">
                  <span className="k">Mission outcome</span>
                  <span className="v" style={{ color: selected.tasking.outcome === "PRESERVED" ? "var(--good)" : "var(--risk-critical)" }}>
                    {selected.tasking.outcome === "PRESERVED" ? "MISSION PRESERVED" : "MISSION AT RISK"}
                  </span>
                </div>
              )}
              <button style={{ marginTop: 12 }} onClick={() => { setTrajectoryMode("VERIFIED"); navigate("/conjunctions"); }}>
                Show verified trajectory in 3D
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
