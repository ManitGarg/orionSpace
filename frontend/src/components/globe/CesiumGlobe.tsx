import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import React, { useEffect, useRef } from "react";
import type { ConjunctionDto, ObjectType, RiskLevel, TrajectorySample } from "../../api/types";
import { buildSampledPosition, julianAt, kmToCartesian, rtnRotationMatrix } from "../../lib/orbit";
import type { CameraMode, DisplayToggles, TrajectoryMode } from "../../state/AppState";
import { riskColorHex } from "../common/RiskBadge";

export interface SceneObject {
  id: string;
  name: string;
  type: ObjectType;
  risk: RiskLevel;
  isDesignatedThreat?: boolean;
  samples: TrajectorySample[];
}

export interface CesiumGlobeProps {
  epoch0Iso: string;
  clockSec: number;
  primary: SceneObject;
  threat: SceneObject;
  nearby: SceneObject[];
  proposedSamples: TrajectorySample[] | null;
  verifiedSamples: TrajectorySample[] | null;
  conjunction: ConjunctionDto | null;
  afterConjunction: ConjunctionDto | null;
  trajectoryMode: TrajectoryMode;
  display: DisplayToggles;
  rangeRingKm: number;
  selectedObjectId: string | null;
  onSelectObject: (id: string | null) => void;
  cameraMode: CameraMode;
  focusRequestId: number;
  pendingFocusMode: "GLOBAL" | "LOCAL" | "TCA" | "RESET" | null;
  burnOffsetSec: number;
  /** present once a maneuver has been simulated; drives the burn marker + thrust vector */
  burnVector: {
    positionKm: [number, number, number];
    directionUnit: [number, number, number];
    deltaVMs: number;
    frameLabel: string;
  } | null;
  onTcaClick: () => void;
}

const COLOR_CURRENT = Cesium.Color.fromCssColorString("#4fa8ff");
const COLOR_PROPOSED = Cesium.Color.fromCssColorString("#e3c14a");
const COLOR_VERIFIED = Cesium.Color.fromCssColorString("#57d19a");
const NEAR_LOD_METERS = 400_000; // below this camera distance, show detailed local-view elements

/** Sparse outline for covariance hulls — see the uncertainty ellipsoid construction. */
const UNCERTAINTY_WIREFRAME = { slicePartitions: 8, stackPartitions: 6 } as const;

/** Graded risk-field shells around the encounter point — see the heatmap construction. */
const HEATMAP_SHELLS: Array<{ sigma: number; color: string; alpha: number }> = [
  { sigma: 1.0, color: "#e2503f", alpha: 0.16 },
  { sigma: 1.8, color: "#e0913c", alpha: 0.1 },
  { sigma: 2.6, color: "#e3c14a", alpha: 0.07 },
  { sigma: 3.4, color: "#57d19a", alpha: 0.045 },
];

function typeGlyph(type: ObjectType): string {
  switch (type) {
    case "SATELLITE":
      return "▲";
    case "DEBRIS":
      return "◆";
    case "ROCKET_BODY":
      return "■";
    default:
      return "●";
  }
}

async function createViewer(container: HTMLDivElement): Promise<Cesium.Viewer> {
  const ionToken = (import.meta as any).env?.VITE_CESIUM_ION_TOKEN as string | undefined;
  let baseLayer: Cesium.ImageryLayer | false = false;
  let terrainProvider: Cesium.TerrainProvider | undefined;

  if (ionToken) {
    Cesium.Ion.defaultAccessToken = ionToken;
    try {
      baseLayer = Cesium.ImageryLayer.fromProviderAsync(Cesium.createWorldImageryAsync(), {});
      terrainProvider = await Cesium.createWorldTerrainAsync();
    } catch {
      baseLayer = false;
    }
  }
  if (!baseLayer) {
    baseLayer = Cesium.ImageryLayer.fromProviderAsync(
      Cesium.TileMapServiceImageryProvider.fromUrl(Cesium.buildModuleUrl("Assets/Textures/NaturalEarthII")),
      {}
    );
  }

  const viewer = new Cesium.Viewer(container, {
    baseLayer,
    terrainProvider,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    shadows: false,
    shouldAnimate: false,
    contextOptions: { webgl: { alpha: false } },
  });

  viewer.scene.globe.enableLighting = true;
  viewer.scene.globe.baseColor = Cesium.Color.fromCssColorString("#050a12");
  viewer.scene.globe.showGroundAtmosphere = true;
  if (viewer.scene.skyAtmosphere) viewer.scene.skyAtmosphere.show = true;
  viewer.scene.backgroundColor = Cesium.Color.fromCssColorString("#05070b");
  viewer.scene.highDynamicRange = false;
  viewer.scene.fog.enabled = true;
  viewer.scene.postProcessStages.fxaa.enabled = true;
  (viewer.cesiumWidget.creditContainer as HTMLElement).style.display = "none";
  viewer.scene.debugShowFramesPerSecond = false;

  return viewer;
}

export function CesiumGlobe(props: CesiumGlobeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const epoch0Ref = useRef<Cesium.JulianDate | null>(null);
  const entityIndex = useRef<Map<string, Cesium.Entity>>(new Map());
  const readyRef = useRef(false);

  const propsRef = useRef(props);
  propsRef.current = props;

  // ---- 1. viewer bootstrap (once) ----
  useEffect(() => {
    let cancelled = false;
    if (!containerRef.current) return;
    createViewer(containerRef.current).then((viewer) => {
      if (cancelled) {
        viewer.destroy();
        return;
      }
      viewerRef.current = viewer;
      readyRef.current = true;
      // dev-only handle for inspecting the scene from the console / e2e checks
      if ((import.meta as any).env?.DEV) (window as any).__orionViewer = viewer;

      viewer.selectedEntity = undefined as any;
      viewer.screenSpaceEventHandler.setInputAction((click: Cesium.ScreenSpaceEventHandler.PositionedEvent) => {
        const picked = viewer.scene.pick(click.position);
        if (Cesium.defined(picked) && picked.id?.id) {
          const id: string = picked.id.id;
          if (id === "tca-marker") {
            propsRef.current.onTcaClick();
            return;
          }
          if (id.startsWith("obj:")) {
            propsRef.current.onSelectObject(id.slice(4));
            return;
          }
        }
        propsRef.current.onSelectObject(null);
      }, Cesium.ScreenSpaceEventType.LEFT_CLICK);

      buildStaticEntities(viewer, entityIndex.current);
      forceRebuildTrigger.current += 1;
      setTick((t) => t + 1);
    });
    return () => {
      cancelled = true;
      viewerRef.current?.destroy();
      viewerRef.current = null;
      readyRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const forceRebuildTrigger = useRef(0);
  const [, setTick] = React.useState(0);

  // ---- 2. epoch / clock bounds ----
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const epoch0 = Cesium.JulianDate.fromIso8601(props.epoch0Iso);
    epoch0Ref.current = epoch0;
    viewer.clock.startTime = epoch0.clone();
    viewer.clock.stopTime = Cesium.JulianDate.addSeconds(epoch0, 4 * 3600 + 600, new Cesium.JulianDate());
    viewer.clock.clockRange = Cesium.ClockRange.CLAMPED;
    viewer.clock.currentTime = Cesium.JulianDate.addSeconds(epoch0, props.clockSec, new Cesium.JulianDate());
  }, [props.epoch0Iso, forceRebuildTrigger.current]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- 3. keep clock synced with sim time ----
  useEffect(() => {
    const viewer = viewerRef.current;
    const epoch0 = epoch0Ref.current;
    if (!viewer || !epoch0) return;
    viewer.clock.currentTime = Cesium.JulianDate.addSeconds(epoch0, props.clockSec, new Cesium.JulianDate());
  }, [props.clockSec, forceRebuildTrigger.current]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---- 4. primary + threat entities (trajectories, markers, local model) ----
  useEffect(() => {
    const viewer = viewerRef.current;
    const epoch0 = epoch0Ref.current;
    if (!viewer || !epoch0) return;
    rebuildPrimaryAndThreat(viewer, epoch0, entityIndex.current, props);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    viewerRef.current,
    forceRebuildTrigger.current,
    props.primary.samples,
    props.threat.samples,
    props.proposedSamples,
    props.verifiedSamples,
    props.trajectoryMode,
  ]);

  // ---- 5. nearby field ----
  useEffect(() => {
    const viewer = viewerRef.current;
    const epoch0 = epoch0Ref.current;
    if (!viewer || !epoch0) return;
    rebuildNearby(viewer, epoch0, entityIndex.current, props.nearby);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerRef.current, forceRebuildTrigger.current, props.nearby]);

  // ---- 6. conjunction-derived entities (TCA marker, separation vector, uncertainty, heatmap, burn marker) ----
  useEffect(() => {
    const viewer = viewerRef.current;
    const epoch0 = epoch0Ref.current;
    if (!viewer || !epoch0) return;
    rebuildConjunctionEntities(viewer, epoch0, entityIndex.current, props);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    viewerRef.current,
    forceRebuildTrigger.current,
    props.conjunction,
    props.afterConjunction,
    props.burnVector,
    props.trajectoryMode,
  ]);

  // ---- 7. display toggles ----
  // Also depends on props.nearby / trajectoryMode: those effects rebuild
  // entities, and freshly-created entities must pick up the current toggles.
  useEffect(() => {
    applyDisplayToggles(entityIndex.current, props);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    props.display,
    props.selectedObjectId,
    props.nearby,
    props.trajectoryMode,
    props.conjunction,
    props.afterConjunction,
    forceRebuildTrigger.current,
  ]);

  // ---- 7b. range rings around the selected object ----
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    rebuildRangeRings(viewer, entityIndex.current, props.selectedObjectId, props.rangeRingKm, props.display.rangeRings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.selectedObjectId, props.rangeRingKm, props.display.rangeRings, forceRebuildTrigger.current]);

  // ---- 8. camera focus requests ----
  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer || props.focusRequestId === 0) return;
    runCameraFocus(viewer, entityIndex.current, props);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.focusRequestId]);

  return <div ref={containerRef} className="cesium-container" />;
}

// ============================================================================
// Entity construction helpers
// ============================================================================

function buildStaticEntities(viewer: Cesium.Viewer, idx: Map<string, Cesium.Entity>) {
  // nothing persistent needed beyond what's rebuilt reactively; placeholder for future static scene dressing
}

function clearGroup(idx: Map<string, Cesium.Entity>, viewer: Cesium.Viewer, prefix: string) {
  for (const [key, entity] of Array.from(idx.entries())) {
    if (key.startsWith(prefix)) {
      viewer.entities.remove(entity);
      idx.delete(key);
    }
  }
}

function rebuildPrimaryAndThreat(
  viewer: Cesium.Viewer,
  epoch0: Cesium.JulianDate,
  idx: Map<string, Cesium.Entity>,
  props: CesiumGlobeProps
) {
  clearGroup(idx, viewer, "primary:");
  clearGroup(idx, viewer, "threat:");

  const { primary, threat, proposedSamples, verifiedSamples, trajectoryMode } = props;

  const primaryPos = buildSampledPosition(epoch0, primary.samples);
  const threatPos = buildSampledPosition(epoch0, threat.samples);

  // orbit track lines
  const currentLine = polylineFromSamples(primary.samples, epoch0);
  addLine(viewer, idx, "primary:line:current", currentLine, COLOR_CURRENT, trajectoryMode === "CURRENT" || trajectoryMode === "OVERLAY", false);

  if (proposedSamples && proposedSamples.length > 1) {
    const propLine = polylineFromSamples(proposedSamples, epoch0);
    addLine(
      viewer,
      idx,
      "primary:line:proposed",
      propLine,
      COLOR_PROPOSED,
      trajectoryMode === "PROPOSED" || trajectoryMode === "OVERLAY",
      true
    );
  }
  if (verifiedSamples && verifiedSamples.length > 1) {
    const verLine = polylineFromSamples(verifiedSamples, epoch0);
    addLine(viewer, idx, "primary:line:verified", verLine, COLOR_VERIFIED, trajectoryMode === "VERIFIED", true);
  }

  const threatLine = polylineFromSamples(threat.samples, epoch0);
  addLine(viewer, idx, "threat:line", threatLine, Cesium.Color.fromCssColorString("#e0913c").withAlpha(0.55), true, true);

  // determine active moving-marker position property for primary
  let activePosProp: Cesium.PositionProperty = primaryPos;
  if (trajectoryMode === "PROPOSED" && proposedSamples && proposedSamples.length > 1) {
    activePosProp = buildSampledPosition(epoch0, proposedSamples);
  } else if (trajectoryMode === "VERIFIED" && verifiedSamples && verifiedSamples.length > 1) {
    activePosProp = buildSampledPosition(epoch0, verifiedSamples);
  }

  const primaryEntity = viewer.entities.add({
    id: "obj:" + primary.id,
    name: primary.name,
    position: activePosProp,
    orientation: new Cesium.VelocityOrientationProperty(activePosProp),
    point: {
      pixelSize: 10,
      color: COLOR_CURRENT,
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 1.5,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
      text: `${primary.name}\nPRIMARY`,
      font: "11px sans-serif",
      fillColor: Cesium.Color.WHITE,
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString("#05070bcc"),
      pixelOffset: new Cesium.Cartesian2(14, -10),
      horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
  idx.set("primary:marker", primaryEntity);

  // local-view detailed cubesat model group (body + panels), shown close-up only
  buildCubesatModel(viewer, idx, "primary:model", activePosProp);

  // OVERLAY: also show a ghost "before" marker on the current path when comparing
  if (trajectoryMode === "OVERLAY" && proposedSamples && proposedSamples.length > 1) {
    const proposedPos = buildSampledPosition(epoch0, proposedSamples);
    const ghost = viewer.entities.add({
      id: "primary:ghost",
      position: proposedPos,
      point: {
        pixelSize: 8,
        color: COLOR_PROPOSED,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: "PROPOSED",
        font: "10px sans-serif",
        fillColor: COLOR_PROPOSED,
        pixelOffset: new Cesium.Cartesian2(12, 6),
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    idx.set("primary:ghost", ghost);
  }

  const threatColor = Cesium.Color.fromCssColorString(riskColorHex(threat.risk));
  const threatEntity = viewer.entities.add({
    id: "obj:" + threat.id,
    name: threat.name,
    position: threatPos,
    orientation: new Cesium.VelocityOrientationProperty(threatPos),
    point: {
      pixelSize: 8,
      color: threatColor,
      outlineColor: Cesium.Color.BLACK,
      outlineWidth: 1,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
      text: `${threat.name}\nTHREAT`,
      font: "11px sans-serif",
      fillColor: threatColor,
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString("#05070bcc"),
      pixelOffset: new Cesium.Cartesian2(14, -10),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
  idx.set("threat:marker", threatEntity);
}

function polylineFromSamples(samples: TrajectorySample[], epoch0: Cesium.JulianDate): Cesium.Cartesian3[] {
  return samples.map((s) => kmToCartesian(s.position));
}

function addLine(
  viewer: Cesium.Viewer,
  idx: Map<string, Cesium.Entity>,
  key: string,
  positions: Cesium.Cartesian3[],
  color: Cesium.Color,
  show: boolean,
  dashed: boolean
) {
  const entity = viewer.entities.add({
    id: key,
    polyline: {
      positions,
      width: 2,
      material: dashed
        ? new Cesium.PolylineDashMaterialProperty({ color, dashLength: 12 })
        : new Cesium.PolylineGlowMaterialProperty({ color, glowPower: 0.15 }),
      show,
      arcType: Cesium.ArcType.NONE,
    },
  });
  idx.set(key, entity);
}

function buildCubesatModel(
  viewer: Cesium.Viewer,
  idx: Map<string, Cesium.Entity>,
  keyPrefix: string,
  positionProp: Cesium.PositionProperty
) {
  const orientation = new Cesium.VelocityOrientationProperty(positionProp);
  const dcCond = new Cesium.DistanceDisplayCondition(0, NEAR_LOD_METERS);

  const body = viewer.entities.add({
    id: keyPrefix + ":body",
    position: positionProp,
    orientation,
    box: {
      dimensions: new Cesium.Cartesian3(60, 40, 40),
      material: Cesium.Color.fromCssColorString("#c7ced9"),
      outline: true,
      outlineColor: Cesium.Color.fromCssColorString("#0a0e15"),
      distanceDisplayCondition: dcCond,
    },
  });
  idx.set(keyPrefix + ":body", body);

  for (const side of [1, -1]) {
    const panel = viewer.entities.add({
      id: `${keyPrefix}:panel:${side}`,
      position: new Cesium.CallbackPositionProperty((time) => {
        const base = positionProp.getValue(time, new Cesium.Cartesian3());
        if (!base) return undefined;
        // offset along the solar-panel axis of the body frame using the orientation quaternion
        const quat = orientation.getValue(time);
        if (!quat) return base;
        const mat = Cesium.Matrix3.fromQuaternion(quat, new Cesium.Matrix3());
        const offsetLocal = new Cesium.Cartesian3(0, side * 100, 0);
        const offsetWorld = Cesium.Matrix3.multiplyByVector(mat, offsetLocal, new Cesium.Cartesian3());
        return Cesium.Cartesian3.add(base, offsetWorld, new Cesium.Cartesian3());
      }, false),
      orientation,
      box: {
        dimensions: new Cesium.Cartesian3(10, 120, 50),
        material: Cesium.Color.fromCssColorString("#1a3a6b"),
        outline: true,
        outlineColor: Cesium.Color.fromCssColorString("#4fa8ff"),
        distanceDisplayCondition: dcCond,
      },
    });
    idx.set(`${keyPrefix}:panel:${side}`, panel);
  }
}

function rebuildNearby(
  viewer: Cesium.Viewer,
  epoch0: Cesium.JulianDate,
  idx: Map<string, Cesium.Entity>,
  nearby: SceneObject[]
) {
  clearGroup(idx, viewer, "nearby:");
  for (const obj of nearby) {
    const pos = buildSampledPosition(epoch0, obj.samples);
    const color = Cesium.Color.fromCssColorString(riskColorHex(obj.risk));
    const isElevated = obj.risk === "MODERATE" || obj.risk === "HIGH" || obj.risk === "CRITICAL";
    const entity = viewer.entities.add({
      id: "obj:" + obj.id,
      name: obj.name,
      position: pos,
      point: {
        pixelSize: isElevated ? 7 : 5,
        color,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 1,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: `${typeGlyph(obj.type)} ${obj.name}`,
        font: "10px sans-serif",
        fillColor: color,
        pixelOffset: new Cesium.Cartesian2(10, 0),
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("#05070bcc"),
        show: false, // toggled in applyDisplayToggles
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    idx.set("nearby:" + obj.id, entity);
  }
}

function rebuildConjunctionEntities(
  viewer: Cesium.Viewer,
  epoch0: Cesium.JulianDate,
  idx: Map<string, Cesium.Entity>,
  props: CesiumGlobeProps
) {
  clearGroup(idx, viewer, "conj:");
  const conj = props.trajectoryMode === "PROPOSED" || props.trajectoryMode === "VERIFIED" ? props.afterConjunction ?? props.conjunction : props.conjunction;
  if (!conj) return;

  const tcaTime = julianAt(epoch0, conj.tcaOffsetSec);
  const primaryAtTca = kmToCartesian(conj.primaryStateAtTca.position);
  const secondaryAtTca = kmToCartesian(conj.secondaryStateAtTca.position);
  const midpoint = Cesium.Cartesian3.midpoint(primaryAtTca, secondaryAtTca, new Cesium.Cartesian3());

  const tcaMarker = viewer.entities.add({
    id: "tca-marker",
    position: midpoint,
    point: {
      pixelSize: 12,
      color: Cesium.Color.fromCssColorString(riskColorHex(conj.risk)),
      outlineColor: Cesium.Color.WHITE,
      outlineWidth: 2,
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
    label: {
      text: `TCA\n${conj.missDistanceKm.toFixed(2)} km`,
      font: "11px sans-serif",
      fillColor: Cesium.Color.WHITE,
      pixelOffset: new Cesium.Cartesian2(0, -26),
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString("#05070bcc"),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
  idx.set("conj:tca", tcaMarker);

  // separation vector: live between primary & threat "true" positions (always the unperturbed pair for now)
  const sep = viewer.entities.add({
    id: "conj:separation",
    polyline: {
      positions: new Cesium.CallbackProperty((time) => {
        const primaryEntity = idx.get("primary:marker");
        const threatEntity = idx.get("threat:marker");
        if (!primaryEntity?.position || !threatEntity?.position || !time) return [];
        const a = primaryEntity.position.getValue(time);
        const b = threatEntity.position.getValue(time);
        if (!a || !b) return [];
        return [a, b];
      }, false),
      width: 1.5,
      material: new Cesium.PolylineDashMaterialProperty({
        color: Cesium.Color.fromCssColorString("#e7edf6").withAlpha(0.8),
        dashLength: 6,
      }),
      arcType: Cesium.ArcType.NONE,
    },
  });
  idx.set("conj:separation", sep);

  // Live readout on the separation vector: current range and range-rate between
  // the two objects, recomputed each frame from the entity positions so it
  // tracks the timeline rather than restating the fixed TCA numbers.
  const livePair = (time: Cesium.JulianDate | undefined) => {
    if (!time) return null;
    const p = idx.get("primary:marker")?.position?.getValue(time, new Cesium.Cartesian3());
    const s = idx.get("threat:marker")?.position?.getValue(time, new Cesium.Cartesian3());
    return p && s ? { p, s } : null;
  };

  const sepLabel = viewer.entities.add({
    id: "conj:separation:label",
    position: new Cesium.CallbackPositionProperty((time) => {
      const pair = livePair(time);
      if (!pair) return undefined;
      return Cesium.Cartesian3.midpoint(pair.p, pair.s, new Cesium.Cartesian3());
    }, false),
    label: {
      text: new Cesium.CallbackProperty((time) => {
        const pair = time ? livePair(time) : null;
        if (!pair || !time) return "";
        const rangeKm = Cesium.Cartesian3.distance(pair.p, pair.s) / 1000;
        // range-rate by finite difference over 1 s, which is stable at every
        // playback speed because it reads the sampled positions, not the clock
        const t2 = Cesium.JulianDate.addSeconds(time, 1, new Cesium.JulianDate());
        const pair2 = livePair(t2);
        let line2 = "";
        if (pair2) {
          const rangeKm2 = Cesium.Cartesian3.distance(pair2.p, pair2.s) / 1000;
          line2 = `\nrange-rate ${(rangeKm2 - rangeKm).toFixed(2)} km/s`;
        }
        return `${rangeKm.toFixed(2)} km${line2}`;
      }, false),
      font: "10px monospace",
      fillColor: Cesium.Color.WHITE,
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString("#05070bdd"),
      pixelOffset: new Cesium.Cartesian2(0, 16),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
  idx.set("conj:separation:label", sepLabel);

  // uncertainty ellipsoids at TCA (primary + secondary), sized from combined covariance split roughly
  const rot = rtnRotationMatrix(conj.primaryStateAtTca.position, conj.primaryStateAtTca.velocity);
  const quat = Cesium.Quaternion.fromRotationMatrix(rot, new Cesium.Quaternion());
  const sxx = Math.sqrt(conj.combinedCovariance.sxx) * 1000; // km sigma -> m
  const syy = Math.sqrt(conj.combinedCovariance.syy) * 1000;
  const threeSigmaScale = 3;

  const uncertaintyPrimary = viewer.entities.add({
    id: "conj:uncertainty:primary",
    position: primaryAtTca,
    orientation: quat,
    ellipsoid: {
      radii: new Cesium.Cartesian3(sxx * threeSigmaScale * 0.35, syy * threeSigmaScale * 0.35, sxx * threeSigmaScale * 0.2),
      material: Cesium.Color.fromCssColorString("#4fa8ff").withAlpha(0.16),
      outline: true,
      outlineColor: Cesium.Color.fromCssColorString("#4fa8ff").withAlpha(0.5),
      // sparse partitions: a few reference rings read as an analytical
      // covariance hull, where Cesium's default 64x64 grid reads as a mesh
      ...UNCERTAINTY_WIREFRAME,
    },
  });
  idx.set("conj:uncertainty:primary", uncertaintyPrimary);

  const uncertaintySecondary = viewer.entities.add({
    id: "conj:uncertainty:secondary",
    position: secondaryAtTca,
    orientation: quat,
    ellipsoid: {
      radii: new Cesium.Cartesian3(sxx * threeSigmaScale, syy * threeSigmaScale, sxx * threeSigmaScale * 0.6),
      material: Cesium.Color.fromCssColorString(riskColorHex(conj.risk)).withAlpha(0.14),
      outline: true,
      outlineColor: Cesium.Color.fromCssColorString(riskColorHex(conj.risk)).withAlpha(0.55),
      ...UNCERTAINTY_WIREFRAME,
    },
  });
  idx.set("conj:uncertainty:secondary", uncertaintySecondary);

  // Risk heatmap (spec §10): nested translucent shells graded red → orange →
  // yellow → green outward from the encounter point. The innermost shell is
  // where the secondary is most likely to be at TCA and so carries the highest
  // spatial risk; each shell out is a lower-probability region. Alphas are kept
  // low deliberately — this is meant to read as an analytical field, not to
  // flood the screen with red.
  HEATMAP_SHELLS.forEach((shell, i) => {
    const entity = viewer.entities.add({
      id: `conj:heatmap:${i}`,
      position: secondaryAtTca,
      orientation: quat,
      ellipsoid: {
        radii: new Cesium.Cartesian3(
          sxx * shell.sigma * threeSigmaScale,
          syy * shell.sigma * threeSigmaScale,
          sxx * shell.sigma * threeSigmaScale * 0.6
        ),
        material: Cesium.Color.fromCssColorString(shell.color).withAlpha(shell.alpha),
        outline: false,
      },
      show: false,
    });
    idx.set(`conj:heatmap:${i}`, entity);
  });

  // Burn event (spec §15): marker at the burn point on the current orbit plus a
  // thrust vector drawn in the maneuver frame. Only meaningful once a maneuver
  // has actually been simulated, which is what `burnVector` carries.
  if (props.burnVector) {
    const burnPos = kmToCartesian(props.burnVector.positionKm);
    const dirUnit = props.burnVector.directionUnit;
    // The arrow length is a fixed display scale, not the Δv magnitude — a
    // 0.42 m/s burn would otherwise be sub-pixel. An along-track burn is
    // collinear with the orbit track by definition, so the arrow is drawn
    // short and heavy to read as an annotation on top of the thin track
    // rather than disappearing into it.
    const ARROW_LEN_M = 12_000;
    const tip = Cesium.Cartesian3.add(
      burnPos,
      new Cesium.Cartesian3(dirUnit[0] * ARROW_LEN_M, dirUnit[1] * ARROW_LEN_M, dirUnit[2] * ARROW_LEN_M),
      new Cesium.Cartesian3()
    );

    const burnMarker = viewer.entities.add({
      id: "conj:burn:marker",
      position: burnPos,
      point: {
        pixelSize: 9,
        color: COLOR_PROPOSED,
        outlineColor: Cesium.Color.WHITE,
        outlineWidth: 1.5,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
      label: {
        text: `BURN · Δv ${props.burnVector.deltaVMs.toFixed(2)} m/s\n${props.burnVector.frameLabel}`,
        font: "10px sans-serif",
        fillColor: COLOR_PROPOSED,
        showBackground: true,
        backgroundColor: Cesium.Color.fromCssColorString("#05070bcc"),
        pixelOffset: new Cesium.Cartesian2(12, 10),
        horizontalOrigin: Cesium.HorizontalOrigin.LEFT,
        disableDepthTestDistance: Number.POSITIVE_INFINITY,
      },
    });
    idx.set("conj:burn:marker", burnMarker);

    const thrust = viewer.entities.add({
      id: "conj:burn:vector",
      polyline: {
        positions: [burnPos, tip],
        width: 14,
        material: new Cesium.PolylineArrowMaterialProperty(COLOR_PROPOSED),
        arcType: Cesium.ArcType.NONE,
      },
    });
    idx.set("conj:burn:vector", thrust);
  }
}

function makeRingPositions(
  centerProp: Cesium.PositionProperty,
  radiusMeters: number,
  time: Cesium.JulianDate
): Cesium.Cartesian3[] | undefined {
  const center = centerProp.getValue(time, new Cesium.Cartesian3());
  if (!center) return undefined;
  const up = Cesium.Cartesian3.normalize(center, new Cesium.Cartesian3());
  let ref = Cesium.Cartesian3.UNIT_Z;
  if (Math.abs(Cesium.Cartesian3.dot(up, ref)) > 0.95) ref = Cesium.Cartesian3.UNIT_X;
  const axis1 = Cesium.Cartesian3.normalize(Cesium.Cartesian3.cross(up, ref, new Cesium.Cartesian3()), new Cesium.Cartesian3());
  const axis2 = Cesium.Cartesian3.cross(up, axis1, new Cesium.Cartesian3());
  const points: Cesium.Cartesian3[] = [];
  const SEGMENTS = 64;
  for (let i = 0; i <= SEGMENTS; i++) {
    const theta = (i / SEGMENTS) * Cesium.Math.TWO_PI;
    const p = Cesium.Cartesian3.add(
      center,
      Cesium.Cartesian3.add(
        Cesium.Cartesian3.multiplyByScalar(axis1, radiusMeters * Math.cos(theta), new Cesium.Cartesian3()),
        Cesium.Cartesian3.multiplyByScalar(axis2, radiusMeters * Math.sin(theta), new Cesium.Cartesian3()),
        new Cesium.Cartesian3()
      ),
      new Cesium.Cartesian3()
    );
    points.push(p);
  }
  return points;
}

function rebuildRangeRings(
  viewer: Cesium.Viewer,
  idx: Map<string, Cesium.Entity>,
  selectedObjectId: string | null,
  rangeRingKm: number,
  show: boolean
) {
  clearGroup(idx, viewer, "ring:");
  if (!show || !selectedObjectId) return;
  const target = idx.get("obj:" + selectedObjectId) ?? idx.get("primary:marker");
  if (!target?.position) return;
  const centerProp = target.position;

  for (const factor of [0.5, 1]) {
    const radiusMeters = rangeRingKm * 1000 * factor;
    const ring = viewer.entities.add({
      id: `ring:${factor}`,
      polyline: {
        positions: new Cesium.CallbackProperty((time) => makeRingPositions(centerProp, radiusMeters, time!), false),
        width: 1,
        material: Cesium.Color.fromCssColorString("#4fa8ff").withAlpha(factor === 1 ? 0.35 : 0.5),
        arcType: Cesium.ArcType.NONE,
      },
    });
    idx.set(`ring:${factor}`, ring);
  }

  const label = viewer.entities.add({
    id: "ring:label",
    position: new Cesium.CallbackPositionProperty((time) => {
      const c = centerProp.getValue(time, new Cesium.Cartesian3());
      if (!c) return undefined;
      return Cesium.Cartesian3.add(c, new Cesium.Cartesian3(0, 0, rangeRingKm * 1000), new Cesium.Cartesian3());
    }, false),
    label: {
      text: `${rangeRingKm} km`,
      font: "10px sans-serif",
      fillColor: Cesium.Color.fromCssColorString("#4fa8ff"),
      showBackground: true,
      backgroundColor: Cesium.Color.fromCssColorString("#05070bcc"),
      disableDepthTestDistance: Number.POSITIVE_INFINITY,
    },
  });
  idx.set("ring:label", label);
}

function applyDisplayToggles(idx: Map<string, Cesium.Entity>, props: CesiumGlobeProps) {
  const { display, selectedObjectId } = props;

  const setShow = (key: string, show: boolean) => {
    const e = idx.get(key);
    if (e) e.show = show;
  };

  setShow("primary:line:current", display.trajectories && (props.trajectoryMode === "CURRENT" || props.trajectoryMode === "OVERLAY"));
  setShow("primary:line:proposed", display.trajectories && (props.trajectoryMode === "PROPOSED" || props.trajectoryMode === "OVERLAY"));
  setShow("primary:line:verified", display.trajectories && props.trajectoryMode === "VERIFIED");
  setShow("threat:line", display.trajectories);

  setShow("conj:separation", display.separation);
  setShow("conj:separation:label", display.separation && display.relativeVelocity);
  setShow("conj:uncertainty:primary", display.uncertainty);
  setShow("conj:uncertainty:secondary", display.uncertainty);
  HEATMAP_SHELLS.forEach((_, i) => setShow(`conj:heatmap:${i}`, display.riskHeatmap));

  // Label policy (spec §4): the primary and the designated threat are always
  // labelled; everything else stays unlabelled unless it is high risk, is the
  // selected object, or the analyst has switched object names on. This is what
  // keeps a populated object field from turning into a wall of text.
  const riskById = new Map(props.nearby.map((o) => [o.id, o.risk]));
  for (const [key, entity] of idx.entries()) {
    if (!entity.label) continue;
    if (key === "primary:marker" || key === "threat:marker") {
      entity.label.show = new Cesium.ConstantProperty(true);
      continue;
    }
    if (!key.startsWith("nearby:")) continue;
    const id = key.slice("nearby:".length);
    const risk = riskById.get(id);
    const isHighRisk = risk === "HIGH" || risk === "CRITICAL";
    entity.label.show = new Cesium.ConstantProperty(display.objectNames || selectedObjectId === id || isHighRisk);
  }
}

function runCameraFocus(viewer: Cesium.Viewer, idx: Map<string, Cesium.Entity>, props: CesiumGlobeProps) {
  const mode = props.pendingFocusMode;
  if (mode === "GLOBAL") {
    viewer.camera.flyHome(1.2);
    return;
  }
  if (mode === "RESET") {
    viewer.camera.flyHome(0.8);
    return;
  }
  if (mode === "TCA") {
    const e = idx.get("conj:tca");
    if (e) viewer.flyTo(e, { duration: 1.4, offset: new Cesium.HeadingPitchRange(0, -0.5, 8000) });
    return;
  }
  if (mode === "LOCAL") {
    const e = idx.get("primary:marker");
    if (e) viewer.flyTo(e, { duration: 1.4, offset: new Cesium.HeadingPitchRange(0, -0.4, 20000) });
  }
}
