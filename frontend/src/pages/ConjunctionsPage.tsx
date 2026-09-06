import React, { useEffect, useMemo, useState } from "react";
import { api } from "../api/client";
import type { ConjunctionCurrentResponse, ManeuverInput, TrajectorySample } from "../api/types";
import { useAppState } from "../state/AppState";
import { CesiumGlobe, SceneObject } from "../components/globe/CesiumGlobe";
import { AnalystControlPanel } from "../components/panels/AnalystControlPanel";
import { ConjunctionDetailsPanel } from "../components/panels/ConjunctionDetailsPanel";
import { TCAInfoPanel } from "../components/panels/TCAInfoPanel";
import { CameraControls } from "../components/panels/CameraControls";
import { SimulationTimeline } from "../components/timeline/SimulationTimeline";
import { BPlaneView } from "../components/bplane/BPlaneView";
import { RiskBadge } from "../components/common/RiskBadge";
import { formatPc } from "../lib/orbit";

/** Name the maneuver frame the operator actually used, for the burn label in the 3D view. */
function dominantFrameLabel(input: ManeuverInput | null): string {
  if (!input) return "";
  const components: Array<[string, number]> = [
    ["Radial", Math.abs(input.deltaVRadialMs)],
    ["Along-track", Math.abs(input.deltaVAlongTrackMs)],
    ["Cross-track", Math.abs(input.deltaVCrossTrackMs)],
  ];
  components.sort((a, b) => b[1] - a[1]);
  return components[0][1] > 0 ? components[0][0] : "";
}

export function ConjunctionsPage() {
  const {
    scenario,
    clockSec,
    trajectoryMode,
    display,
    rangeRingKm,
    selectedObjectId,
    setSelectedObjectId,
    cameraMode,
    focusRequestId,
    pendingFocusMode,
    burnOffsetSec,
    viewMode,
    maneuverResult,
    activeProposal,
    setConjunctionFocused,
    requestFocus,
  } = useAppState();

  const [conjunction, setConjunction] = useState<ConjunctionCurrentResponse | null>(null);
  const [primarySamples, setPrimarySamples] = useState<TrajectorySample[]>([]);
  const [threatSamples, setThreatSamples] = useState<TrajectorySample[]>([]);
  const [nearbyScene, setNearbyScene] = useState<SceneObject[]>([]);
  const [tcaPanelOpen, setTcaPanelOpen] = useState(false);

  // ---- load trajectories + conjunction once per scenario ----
  useEffect(() => {
    if (!scenario) return;
    const end = scenario.windowEndSec;
    let cancelled = false;

    api.conjunctionCurrent().then((c) => !cancelled && setConjunction(c));
    api.trajectory(scenario.primary.id, 0, end, 60).then((r) => !cancelled && setPrimarySamples(r.samples));
    api.trajectory(scenario.threat.id, 0, end, 60).then((r) => !cancelled && setThreatSamples(r.samples));

    // Nearby objects are sampled at a coarser step: they exist to convey a
    // populated environment, not to be analyzed individually, so a 5-minute
    // step is plenty and keeps the entity/sample count low (perf req. §26).
    Promise.all(
      scenario.nearby.map((o) =>
        api.trajectory(o.id, 0, end, 300).then((r) => ({
          id: o.id,
          name: o.name,
          type: o.type,
          risk: "SAFE" as const,
          samples: r.samples,
        }))
      )
    ).then((objs) => !cancelled && setNearbyScene(objs));

    return () => {
      cancelled = true;
    };
  }, [scenario]);

  const tcaOffsetSec = useMemo(() => {
    if (!scenario) return 7200;
    return (new Date(scenario.tcaIso).getTime() - new Date(scenario.epoch0Iso).getTime()) / 1000;
  }, [scenario]);

  // proposed / verified trajectories come from the workflow state, so the
  // 3D view reflects whatever the operator has actually simulated/submitted
  const proposedSamples = maneuverResult?.proposedSamples ?? activeProposal?.proposedSamples ?? null;
  const verifiedSamples = activeProposal?.verification?.verifiedSamples ?? null;
  const afterConjunction =
    trajectoryMode === "VERIFIED"
      ? activeProposal?.verification?.verifiedConjunction ?? null
      : maneuverResult?.after ?? activeProposal?.simulation.after ?? null;

  // Burn geometry for the 3D view: the thrust direction is the actual velocity
  // change between the pre- and post-burn states, so the arrow points where the
  // Δv really acted rather than at a hard-coded axis.
  const burnSim = maneuverResult ?? activeProposal?.simulation ?? null;
  const burnVector = useMemo(() => {
    if (!burnSim) return null;
    const before = burnSim.burnStateBefore;
    const after = burnSim.burnStateAfter;
    const dv: [number, number, number] = [
      after.velocity[0] - before.velocity[0],
      after.velocity[1] - before.velocity[1],
      after.velocity[2] - before.velocity[2],
    ];
    const mag = Math.hypot(dv[0], dv[1], dv[2]);
    if (mag < 1e-12) return null;
    const input = maneuverResult?.maneuverInput ?? activeProposal?.maneuverInput ?? null;
    const frameLabel = dominantFrameLabel(input);
    return {
      positionKm: before.position,
      directionUnit: [dv[0] / mag, dv[1] / mag, dv[2] / mag] as [number, number, number],
      deltaVMs: burnSim.deltaVMagnitudeMs,
      frameLabel,
    };
  }, [burnSim, maneuverResult, activeProposal]);

  if (!scenario) return null;

  const primaryScene: SceneObject = {
    id: scenario.primary.id,
    name: scenario.primary.name,
    type: scenario.primary.type,
    risk: "SAFE",
    samples: primarySamples,
  };
  const threatScene: SceneObject = {
    id: scenario.threat.id,
    name: scenario.threat.name,
    type: scenario.threat.type,
    risk: conjunction?.risk ?? "HIGH",
    isDesignatedThreat: true,
    samples: threatSamples,
  };

  const showBPlane = viewMode === "BPLANE";
  const bplaneConjunction =
    trajectoryMode === "PROPOSED" || trajectoryMode === "VERIFIED" ? afterConjunction ?? conjunction : conjunction;

  return (
    <div className="workspace">
      <div className="viewport-area">
        {showBPlane && bplaneConjunction ? (
          <BPlaneView
            conjunction={bplaneConjunction}
            label={trajectoryMode === "CURRENT" || trajectoryMode === "OVERLAY" ? "CURRENT ENCOUNTER" : `${trajectoryMode} ENCOUNTER`}
          />
        ) : (
          primarySamples.length > 0 &&
          threatSamples.length > 0 && (
            <CesiumGlobe
              epoch0Iso={scenario.epoch0Iso}
              clockSec={clockSec}
              primary={primaryScene}
              threat={threatScene}
              nearby={nearbyScene}
              proposedSamples={proposedSamples}
              verifiedSamples={verifiedSamples}
              conjunction={conjunction}
              afterConjunction={afterConjunction}
              trajectoryMode={trajectoryMode}
              display={display}
              rangeRingKm={rangeRingKm}
              selectedObjectId={selectedObjectId}
              onSelectObject={setSelectedObjectId}
              cameraMode={cameraMode}
              focusRequestId={focusRequestId}
              pendingFocusMode={pendingFocusMode}
              burnOffsetSec={burnOffsetSec}
              burnVector={burnVector}
              onTcaClick={() => setTcaPanelOpen(true)}
            />
          )
        )}

        {!showBPlane && (
          <>
            <div className="floating-topleft">
              <button
                onClick={() => {
                  setConjunctionFocused(true);
                  requestFocus("TCA");
                }}
              >
                CONJUNCTION FOCUS
              </button>
            </div>
            <ConjunctionDetailsPanel
              primaryName={scenario.primary.name}
              secondaryName={scenario.threat.name}
              conjunction={conjunction}
              afterConjunction={afterConjunction}
            />
            <AnalystControlPanel />
            <CameraControls />
            {tcaPanelOpen && bplaneConjunction && (
              <TCAInfoPanel
                conjunction={bplaneConjunction}
                primaryName={scenario.primary.name}
                secondaryName={scenario.threat.name}
                onClose={() => setTcaPanelOpen(false)}
              />
            )}
          </>
        )}
        {showBPlane && <AnalystControlPanel />}

        <div className="disclaimer-footer">
          DEMO / SIMULATED — synthetic orbits, covariance and collision probability. Not an operational collision
          prediction. ORION does not command spacecraft or execute burns.
        </div>
      </div>

      <SimulationTimeline windowEndSec={scenario.windowEndSec} tcaOffsetSec={tcaOffsetSec} />

      <div
        style={{
          background: "var(--bg-1)",
          borderTop: "1px solid var(--border)",
          padding: "8px 14px",
          display: "flex",
          gap: 20,
          alignItems: "center",
          fontSize: 12,
        }}
      >
        <span style={{ letterSpacing: 1, color: "var(--text-low)", fontSize: 10.5 }}>CONJUNCTION DETAILS</span>
        {bplaneConjunction && (
          <>
            <RiskBadge risk={bplaneConjunction.risk} />
            <span className="mono">Pc: {formatPc(bplaneConjunction.collisionProbability)}</span>
            <span className="mono">Miss Distance: {bplaneConjunction.missDistanceKm.toFixed(2)} km</span>
            <span className="mono">Rel. Vel: {bplaneConjunction.relativeVelocityKms.toFixed(2)} km/s</span>
            <span style={{ color: "var(--text-low)" }}>
              {scenario.primary.name} ↔ {scenario.threat.name}
            </span>
          </>
        )}
      </div>
    </div>
  );
}
