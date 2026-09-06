export type ObjectType = "SATELLITE" | "DEBRIS" | "ROCKET_BODY" | "INACTIVE";
export type RiskLevel = "SAFE" | "MODERATE" | "HIGH" | "CRITICAL";

// ---------------------------------------------------------------- auth ----
export type Role = "OPERATOR" | "AUTHORITY";

export interface AuthUser {
  id: string;
  role: Role;
  displayName: string;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
  permissions: string[];
}

// ------------------------------------------------------------ risk score --
export type RiskClassification = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface RiskScoreDto {
  pc: number;
  consequenceFactor: number;
  riskScore: number;
  classification: RiskClassification;
  consequenceBreakdown: Array<{ label: string; value: string }>;
}

// --------------------------------------------------------------- tasking --
export type TaskStatus = "IN_PROGRESS" | "NO_LONGER_FEASIBLE" | "REASSIGNED" | "AT_RISK";
export type MissionOutcome = "PRESERVED" | "AT_RISK";

export interface MissionTask {
  taskId: string;
  mission: string;
  target: string;
  targetLatDeg: number;
  targetLonDeg: number;
  priority: "ROUTINE" | "HIGH" | "CRITICAL";
  deadlineMinutes: number;
  assignedSatellite: string;
  status: TaskStatus;
  nominalAccessOffsetSec: number;
}

export interface CandidateEvaluation {
  satelliteId: string;
  available: boolean;
  collisionRisk: "ACCEPTABLE" | "ELEVATED";
  sensorCompatible: boolean;
  timeToTargetMinutes: number;
  withinDeadline: boolean;
  feasible: boolean;
  note: string;
}

export interface TaskImpact {
  outageStartSec: number;
  outageEndSec: number;
  outageMinutes: number;
  nominalAccessOffsetSec: number;
  postManeuverGroundRangeKm: number;
  sensorSwathKm: number;
  arrivalShiftSec: number;
  accessInsideOutage: boolean;
  outsideSwath: boolean;
  stillFeasible: boolean;
  reason: string;
}

export interface TimelineEvent {
  at: string;
  label: string;
}

export interface TaskingAssessment {
  task: MissionTask;
  impact: TaskImpact;
  candidates: CandidateEvaluation[];
  selectedSatellite: string | null;
  outcome: MissionOutcome;
  outcomeDetail: string;
  timeline: TimelineEvent[];
  disclaimer: string;
}

export interface ObjectMeta {
  id: string;
  name: string;
  type: ObjectType;
  isDesignatedThreat: boolean;
}

export interface ScenarioResponse {
  epoch0Iso: string;
  tcaIso: string;
  windowStartSec: number;
  windowEndSec: number;
  primary: ObjectMeta;
  threat: ObjectMeta;
  nearby: ObjectMeta[];
  disclaimer: string;
}

export interface StateVectorDto {
  epoch: number;
  position: [number, number, number];
  velocity: [number, number, number];
}

export interface TrajectorySample {
  t: number;
  position: [number, number, number];
  velocity: [number, number, number];
}

export interface TrajectoryResponse {
  objectId: string;
  epoch0Iso: string;
  samples: TrajectorySample[];
}

export interface NearbyObjectDto extends ObjectMeta {
  position: [number, number, number];
  velocity: [number, number, number];
  distanceKm: number;
  relativeVelocityKms: number;
  risk: RiskLevel;
}

export interface NearbyResponse {
  atSec: number;
  primary: ObjectMeta & { position: [number, number, number]; velocity: [number, number, number] };
  objects: NearbyObjectDto[];
}

export interface BPlaneFrameDto {
  rHat: [number, number, number];
  tHat: [number, number, number];
  bR: number;
  bT: number;
  missDistanceKm: number;
}

export interface ConjunctionDto {
  tcaOffsetSec: number;
  tcaIso: string;
  missDistanceKm: number;
  relativeVelocityKms: number;
  collisionProbability: number;
  risk: RiskLevel;
  bplane: BPlaneFrameDto;
  combinedCovariance: { sxx: number; syy: number; sxy: number };
  hbrKm: number;
  /** R = Pc x C, with the consequence breakdown that produced C */
  scoring: RiskScoreDto;
  altitudeKm: number;
  primaryStateAtTca: StateVectorDto;
  secondaryStateAtTca: StateVectorDto;
}

export interface ConjunctionCurrentResponse extends ConjunctionDto {
  primaryId: string;
  secondaryId: string;
  disclaimer: string;
}

export interface ManeuverInput {
  burnOffsetSec: number;
  deltaVRadialMs: number;
  deltaVAlongTrackMs: number;
  deltaVCrossTrackMs: number;
}

export interface SafetyGateCheck {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface SafetyGateResult {
  checks: SafetyGateCheck[];
  overall: "CLEARED" | "FLAGGED" | "BLOCKED";
  reason: string;
}

export interface ManeuverSimulateResponse {
  maneuverInput: ManeuverInput;
  burnOffsetSec: number;
  burnStateBefore: StateVectorDto;
  burnStateAfter: StateVectorDto;
  deltaVMagnitudeMs: number;
  before: ConjunctionDto;
  after: ConjunctionDto;
  proposedSamples: TrajectorySample[];
  safetyGate: SafetyGateResult;
  /** mission-continuity verdict computed from this maneuver */
  tasking: TaskingAssessment;
  disclaimer: string;
}

export type ProposalStatus = "PENDING_AUTHORITY" | "APPROVED" | "REVISION_REQUESTED" | "REJECTED" | "VERIFIED";

export interface Proposal {
  id: string;
  createdAt: string;
  operator: string;
  status: ProposalStatus;
  maneuverInput: ManeuverInput;
  simulation: {
    burnOffsetSec: number;
    burnStateBefore: StateVectorDto;
    burnStateAfter: StateVectorDto;
    deltaVMagnitudeMs: number;
    before: ConjunctionDto;
    after: ConjunctionDto;
  };
  proposedSamples: TrajectorySample[];
  safetyGate: SafetyGateResult;
  tasking: TaskingAssessment;
  authorityNote?: string;
  decidedBy?: string;
  decidedAt?: string;
  verification?: {
    verifiedConjunction: ConjunctionDto;
    verifiedSamples: TrajectorySample[];
    secondaryConjunctionsFound: number;
    resolvedAt: string;
  };
}
