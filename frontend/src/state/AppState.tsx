import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api/client";
import type { ManeuverSimulateResponse, Proposal, ScenarioResponse } from "../api/types";

export type TrajectoryMode = "CURRENT" | "PROPOSED" | "VERIFIED" | "OVERLAY";
export type ViewMode = "3D" | "BPLANE";
export type CameraMode = "GLOBAL" | "LOCAL";
export type PlaybackSpeed = 0.5 | 1 | 5 | 10 | 50;

export interface DisplayToggles {
  objectNames: boolean;
  separation: boolean;
  relativeVelocity: boolean;
  trajectories: boolean;
  uncertainty: boolean;
  rangeRings: boolean;
  bplane: boolean;
  riskHeatmap: boolean;
}

interface AppStateShape {
  scenario: ScenarioResponse | null;
  loading: boolean;
  error: string | null;

  // simulation clock: seconds offset from scenario.epoch0Iso
  clockSec: number;
  setClockSec: (v: number) => void;
  playing: boolean;
  setPlaying: (v: boolean) => void;
  speed: PlaybackSpeed;
  setSpeed: (v: PlaybackSpeed) => void;
  jumpToTCA: () => void;
  jumpToBurn: () => void;
  jumpToPostBurn: () => void;
  reset: () => void;

  burnOffsetSec: number;
  setBurnOffsetSec: (v: number) => void;

  selectedObjectId: string | null;
  setSelectedObjectId: (id: string | null) => void;
  conjunctionFocused: boolean;
  setConjunctionFocused: (v: boolean) => void;

  trajectoryMode: TrajectoryMode;
  setTrajectoryMode: (m: TrajectoryMode) => void;
  viewMode: ViewMode;
  setViewMode: (m: ViewMode) => void;
  cameraMode: CameraMode;
  setCameraMode: (m: CameraMode) => void;

  display: DisplayToggles;
  toggleDisplay: (key: keyof DisplayToggles) => void;

  rangeRingKm: 1 | 5 | 10 | 50;
  setRangeRingKm: (v: 1 | 5 | 10 | 50) => void;

  focusRequestId: number;
  requestFocus: (mode: "GLOBAL" | "LOCAL" | "TCA" | "RESET") => void;
  pendingFocusMode: "GLOBAL" | "LOCAL" | "TCA" | "RESET" | null;

  // shared workflow state (Maneuver Lab -> 3D view -> Mission Continuity -> Proposals)
  maneuverResult: ManeuverSimulateResponse | null;
  setManeuverResult: React.Dispatch<React.SetStateAction<ManeuverSimulateResponse | null>>;
  activeProposal: Proposal | null;
  setActiveProposal: React.Dispatch<React.SetStateAction<Proposal | null>>;
}

const AppStateContext = createContext<AppStateShape | null>(null);

const DEFAULT_BURN_OFFSET_SEC = 1800; // T-90min from window start == 30min before TCA(-ish) tuned default

export function AppStateProvider({ children }: { children: React.ReactNode }) {
  const [scenario, setScenario] = useState<ScenarioResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .scenario()
      .then((s) => setScenario(s))
      .catch((e) => setError(String(e?.message ?? e)))
      .finally(() => setLoading(false));
  }, []);

  const [clockSec, setClockSec] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<PlaybackSpeed>(1);
  const [burnOffsetSec, setBurnOffsetSec] = useState(DEFAULT_BURN_OFFSET_SEC);

  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [conjunctionFocused, setConjunctionFocused] = useState(false);
  const [trajectoryMode, setTrajectoryMode] = useState<TrajectoryMode>("CURRENT");
  const [viewMode, setViewMode] = useState<ViewMode>("3D");
  const [cameraMode, setCameraMode] = useState<CameraMode>("GLOBAL");
  const [rangeRingKm, setRangeRingKm] = useState<1 | 5 | 10 | 50>(5);

  const [display, setDisplay] = useState<DisplayToggles>({
    objectNames: true,
    separation: true,
    relativeVelocity: true,
    trajectories: true,
    uncertainty: true,
    rangeRings: false,
    bplane: false,
    riskHeatmap: false,
  });
  const toggleDisplay = useCallback((key: keyof DisplayToggles) => {
    setDisplay((d) => ({ ...d, [key]: !d[key] }));
  }, []);

  const windowEndSec = scenario?.windowEndSec ?? 14400;

  // Playback loop: rAF-driven but state updates are throttled (~12Hz) rather
  // than on every frame. Orbital motion here is slow enough on screen that
  // this reads as smooth, while keeping React re-render rate bounded across
  // every consumer of this context (see perf notes in README).
  const rafRef = useRef<number | null>(null);
  const lastTsRef = useRef<number | null>(null);
  const accumRef = useRef(0);
  const THROTTLE_MS = 80;
  useEffect(() => {
    if (!playing) return;
    const step = (ts: number) => {
      if (lastTsRef.current == null) lastTsRef.current = ts;
      const dtMs = ts - lastTsRef.current;
      lastTsRef.current = ts;
      accumRef.current += dtMs;
      if (accumRef.current >= THROTTLE_MS) {
        const elapsedSec = (accumRef.current / 1000) * speed;
        accumRef.current = 0;
        setClockSec((c) => {
          const next = c + elapsedSec;
          if (next >= windowEndSec) {
            setPlaying(false);
            return windowEndSec;
          }
          return next;
        });
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      lastTsRef.current = null;
      accumRef.current = 0;
    };
  }, [playing, speed, windowEndSec]);

  const tcaOffsetSec = useMemo(() => {
    if (!scenario) return 7200;
    return (new Date(scenario.tcaIso).getTime() - new Date(scenario.epoch0Iso).getTime()) / 1000;
  }, [scenario]);

  const jumpToTCA = useCallback(() => setClockSec(tcaOffsetSec), [tcaOffsetSec]);
  const jumpToBurn = useCallback(() => setClockSec(burnOffsetSec), [burnOffsetSec]);
  const jumpToPostBurn = useCallback(() => setClockSec(burnOffsetSec + 60), [burnOffsetSec]);
  const reset = useCallback(() => {
    setClockSec(0);
    setPlaying(false);
  }, []);

  const [maneuverResult, setManeuverResult] = useState<ManeuverSimulateResponse | null>(null);
  const [activeProposal, setActiveProposal] = useState<Proposal | null>(null);

  const [focusRequestId, setFocusRequestId] = useState(0);
  const [pendingFocusMode, setPendingFocusMode] = useState<"GLOBAL" | "LOCAL" | "TCA" | "RESET" | null>(null);
  const requestFocus = useCallback((mode: "GLOBAL" | "LOCAL" | "TCA" | "RESET") => {
    setPendingFocusMode(mode);
    setFocusRequestId((n) => n + 1);
  }, []);

  const value: AppStateShape = {
    scenario,
    loading,
    error,
    clockSec,
    setClockSec,
    playing,
    setPlaying,
    speed,
    setSpeed,
    jumpToTCA,
    jumpToBurn,
    jumpToPostBurn,
    reset,
    burnOffsetSec,
    setBurnOffsetSec,
    selectedObjectId,
    setSelectedObjectId,
    conjunctionFocused,
    setConjunctionFocused,
    trajectoryMode,
    setTrajectoryMode,
    viewMode,
    setViewMode,
    cameraMode,
    setCameraMode,
    display,
    toggleDisplay,
    rangeRingKm,
    setRangeRingKm,
    focusRequestId,
    requestFocus,
    pendingFocusMode,
    maneuverResult,
    setManeuverResult,
    activeProposal,
    setActiveProposal,
  };

  return <AppStateContext.Provider value={value}>{children}</AppStateContext.Provider>;
}

export function useAppState(): AppStateShape {
  const ctx = useContext(AppStateContext);
  if (!ctx) throw new Error("useAppState must be used within AppStateProvider");
  return ctx;
}
