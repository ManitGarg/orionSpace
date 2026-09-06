import React from "react";
import { useAppState } from "../../state/AppState";

export function CameraControls() {
  const { cameraMode, setCameraMode, requestFocus } = useAppState();
  return (
    <div className="floating-camera-controls">
      <button
        className={cameraMode === "GLOBAL" ? "active" : ""}
        onClick={() => {
          setCameraMode("GLOBAL");
          requestFocus("GLOBAL");
        }}
      >
        GLOBAL VIEW
      </button>
      <button
        className={cameraMode === "LOCAL" ? "active" : ""}
        onClick={() => {
          setCameraMode("LOCAL");
          requestFocus("LOCAL");
        }}
      >
        LOCAL VIEW
      </button>
      <button onClick={() => requestFocus("TCA")}>FOCUS TCA</button>
      <button onClick={() => requestFocus("RESET")}>RESET CAMERA</button>
    </div>
  );
}
