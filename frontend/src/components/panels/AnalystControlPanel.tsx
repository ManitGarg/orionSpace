import React from "react";
import { useAppState, DisplayToggles } from "../../state/AppState";

const DISPLAY_ITEMS: Array<{ key: keyof DisplayToggles; label: string }> = [
  { key: "objectNames", label: "Object Names" },
  { key: "separation", label: "Show Separation" },
  { key: "relativeVelocity", label: "Show Relative Velocity" },
  { key: "trajectories", label: "Show Trajectories" },
  { key: "uncertainty", label: "Show Uncertainty" },
  { key: "rangeRings", label: "Show Range Rings" },
  { key: "riskHeatmap", label: "Show Risk Heatmap" },
];

export function AnalystControlPanel() {
  const {
    display,
    toggleDisplay,
    trajectoryMode,
    setTrajectoryMode,
    jumpToTCA,
    viewMode,
    setViewMode,
    rangeRingKm,
    setRangeRingKm,
  } = useAppState();

  return (
    <div className="panel floating-bottomleft">
      <div className="panel-title">
        ANALYST CONTROLS
        <button style={{ padding: "1px 6px", fontSize: 10 }} onClick={jumpToTCA}>
          Jump to TCA
        </button>
      </div>

      <div className="segmented">
        {(["3D", "BPLANE"] as const).map((m) => (
          <button key={m} className={viewMode === m ? "active" : ""} onClick={() => setViewMode(m)}>
            {m === "3D" ? "3D VIEW" : "B-PLANE"}
          </button>
        ))}
      </div>

      <div style={{ padding: "0 10px 6px", fontSize: 10, color: "var(--text-low)", letterSpacing: 0.6 }}>DISPLAY</div>
      {DISPLAY_ITEMS.map((item) => (
        <label className="check-row" key={item.key}>
          <input type="checkbox" checked={display[item.key]} onChange={() => toggleDisplay(item.key)} />
          {item.label}
        </label>
      ))}

      {display.rangeRings && (
        <div className="segmented" style={{ paddingTop: 2 }}>
          {[1, 5, 10, 50].map((km) => (
            <button
              key={km}
              className={rangeRingKm === km ? "active" : ""}
              onClick={() => setRangeRingKm(km as 1 | 5 | 10 | 50)}
            >
              {km} km
            </button>
          ))}
        </div>
      )}

      <div style={{ padding: "6px 10px 6px", fontSize: 10, color: "var(--text-low)", letterSpacing: 0.6 }}>TRAJECTORY</div>
      <div className="segmented">
        {(["CURRENT", "PROPOSED", "VERIFIED", "OVERLAY"] as const).map((m) => (
          <button key={m} className={trajectoryMode === m ? "active" : ""} onClick={() => setTrajectoryMode(m)}>
            {m}
          </button>
        ))}
      </div>
    </div>
  );
}
