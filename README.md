# ORION — Orbital Vision

**India's Operator-to-Authority Space Safety Layer** — hackathon prototype.

ORION is a decision-support interface for satellite collision avoidance. It takes an
operator from *"there is a conjunction"* to *"the maneuver was verified and the event is
resolved"*, with a 3D Space Situational Awareness view as the analytical workspace rather
than as decoration.

> ### ⚠️ Prototype disclaimer
>
> Every object, orbit, covariance and collision probability in this repository is
> **synthetic**. ORION does **not** command spacecraft, execute burns, grant official
> authority approval, or integrate with any government system. Values labelled
> **DEMO / SIMULATED** in the UI are exactly that — they are not operational collision
> predictions, and the human operator and authorised authority remain responsible for
> every real decision.

---

## The workflow

```
OPERATOR LOGIN → CONJUNCTION → RISK CALCULATION (R = Pc × C) → OPERATOR MANEUVER
   → PROPOSED TRAJECTORY → MISSION IMPACT → AUTOMATIC RE-TASKING → SAFETY GATE
   → AUTHORITY LOGIN → AUTHORITY REVIEW → VERIFICATION → EVENT RESOLVED
```

Each stage is a real computation against the same propagated orbital state, not a
scripted animation. Changing the operator's Δv changes the propagated trajectory, which
changes the miss distance, which changes Pc, which changes the risk score, which changes
what the safety gate says — and changing the *burn time* changes whether the spacecraft
can still service its imaging task.

ORION does not simply avoid a collision. It calculates the risk, performs the maneuver,
understands the impact on the satellite's mission, and automatically reassigns the task
to another satellite to preserve the mission.

---

## Roles and access

Two roles with a deliberately disjoint decision boundary: **an operator may propose but
never approve their own maneuver, and an authority may decide but never edit the
operator's maneuver parameters.**

| | Operator | Authority |
| --- | --- | --- |
| View conjunctions, 3D geometry, risk calculations | ✓ | ✓ |
| Enter maneuver parameters / run simulations | ✓ | — |
| Submit maneuver proposal | ✓ | — |
| Approve / request revision / reject | — | ✓ |
| Run post-maneuver verification | — | ✓ |

Sign in at `/login` (role selection), `/login/operator`, or `/login/authority`.

**Demo credentials:**

```
Operator    operator@orion.demo    ORION-OP-2026
Authority   authority@orion.demo   ORION-AUTH-2026
```

Credentials are read from environment variables on the backend (see
`server/.env.example`) and are never compiled into the frontend bundle. Guards are
enforced on both sides: React route guards for navigation, and permission checks on the
API so a crafted request cannot bypass the UI. Sessions are HMAC-signed tokens held in
memory — restarting the server signs everyone out, and the client redirects to login on
any 401.

---

## Running it

Two processes. Backend first:

```bash
cd server
npm install
npm run dev          # http://localhost:4000
```

Then the frontend (Vite proxies `/api` to the backend):

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173
```

Open <http://localhost:5173> and the app lands on the **Conjunctions** workspace.

### Earth imagery

By default the globe renders with Cesium's bundled offline Natural Earth II imagery, so
it works with no account and no network. For high-resolution imagery and terrain, add a
[Cesium ion](https://ion.cesium.com) token:

```bash
# frontend/.env.local
VITE_CESIUM_ION_TOKEN=your_token_here
```

The viewer falls back to the offline imagery automatically if the token is missing or
the request fails — the demo never breaks on a missing asset.

---

## The demo path

1. **Sign in as operator** at `/login` → `OPERATOR ACCESS`.
2. **Conjunctions** — the workspace opens on the primary satellite (`MUJ-CubeSat-01`) and
   the designated threat (`DEB-47291`), with a live conjunction at ~0.9 km miss distance
   and Pc in the 1e-4 range.
3. **Focus the encounter** — `FOCUS TCA` / `CONJUNCTION FOCUS` flies the camera to the
   encounter region; the TCA marker, separation vector and uncertainty ellipsoids are
   visible there.
4. **B-plane** — switch the analyst panel to `B-PLANE` to see *why* it is risky: the
   hard-body safety region sits inside the 3σ covariance ellipse.
5. **Maneuver Lab** — the risk calculation is shown *before* any maneuver is entered:
   `R = Pc × C` = 3.3 × 10⁻⁴ × 884 = **0.2955 → CRITICAL**. That number is the
   justification for burning.
6. **Run the simulation** (default: 0.42 m/s along-track, 30 min into the window).
   Before/after cards recompute from the propagated post-burn trajectory:
   **0.2955 (CRITICAL) → 8.84 × 10⁻⁶ (LOW)**, a >99.99% risk reduction.
7. **Mission impact** — the same burn costs SAT-A its imaging task. ORION detects it,
   screens the fleet, and reassigns `TASK-001` to **SAT-B** → **MISSION PRESERVED**.
8. **Submit** → the proposal moves to the Authority Console. The operator cannot approve
   it; the approve/reject controls are not shown to them.
9. **Sign in as authority** — review the same conjunction, risk calculation, mission
   impact and safety gate, all read-only, then approve.
10. **Verification** — the executed orbit is re-propagated with a simulated ±3% execution
    error, screening is re-run against the whole tracked field, and the event resolves.

Back in the 3D view, the `CURRENT / PROPOSED / VERIFIED / OVERLAY` control shows each
trajectory state, and the timeline plays the encounter through with the separation vector
and range readout updating live.

---

## Risk calculation

The Maneuver Lab's primary output is the worked calculation, not a bare label:

```
R = Pc × C

Pc = 3.3 × 10⁻⁴        collision probability (B-plane integration)
C  = 884               consequence factor
R  = 0.2955            → CRITICAL
```

**Pc** comes from the existing conjunction model — the 2D Gaussian integrated over the
hard-body disk in the B-plane. **C** is built in `server/src/lib/risk.ts` from properties
ORION already models, and the panel shows its breakdown rather than a magic number:

| Term | Basis |
| --- | --- |
| Asset loss baseline | 300 — losing an operational spacecraft at all |
| Collision energy | `log₁₀(½mv²)` — a more energetic impact produces a worse debris field |
| Debris persistence | encounter altitude — debris near 800 km persists for centuries; below 400 km it re-enters within years |

The classification (`LOW / MEDIUM / HIGH / CRITICAL`) is **derived from R**, so the label
follows from the number instead of being asserted alongside it. Object-level risk colours
in the 3D view still key off Pc, which is the right basis for a marker colour.

---

## Mission continuity

The interesting operational bind: **the burn that saves the spacecraft is also the burn
that costs it the imaging pass.** ORION computes that rather than asserting it. Two real
effects are modelled in `server/src/lib/tasking.ts`:

- **Attitude outage.** A CA burn means slewing to thrust attitude, burning, then settling
  and re-acquiring attitude reference before the payload can point again. That window
  scales with Δv. If the target access window falls inside it, the image cannot be taken.
  For a small along-track burn this dominates.
- **Ground-track displacement.** A cross-track Δv moves the ground track laterally; if the
  target leaves the sensor swath the image is lost regardless of timing. An along-track Δv
  mostly shifts arrival *time*, which is why it rarely breaks pointing on its own — the
  engine reports that honestly rather than pretending otherwise.

Because both are driven by the operator's actual burn time and Δv, **the verdict changes
with the input**: the default T+30 min burn loses the task (access at T+38 min falls
inside the T+26→T+44 outage), but moving the burn to T+5 min genuinely preserves it and
the UI says so. That responsiveness is the decision-support value — ORION can tell an
operator their maneuver is sound for collision avoidance but lands on top of their imaging
pass.

When SAT-A can no longer service the task, the fleet is screened on availability, own
collision risk, sensor compatibility and time-to-target against the deadline. SAT-B wins;
SAT-C is rejected for elevated own-risk and SAT-D for payload incompatibility. The
reassignment, the timeline and the mission outcome travel with the proposal, so the
authority reviews exactly what the operator saw.

---

## Architecture

```
server/                 Express + TypeScript API
  src/lib/kepler.ts       two-body propagation (universal-variable Kepler solver),
                          RTN frame construction, Δv application
  src/lib/tle.ts          SGP4 via satellite.js; synthetic TLE generation
  src/lib/scenario.ts     the demo scenario — primary, threat, tracked-object field
  src/lib/conjunction.ts  TCA search (coarse scan + ternary refine) and assessment
  src/lib/covariance.ts   B-plane construction, combined covariance, Pc integration
  src/lib/risk.ts         consequence factor C and the risk score R = Pc × C
  src/lib/maneuver.ts     maneuver simulation: before/after conjunction assessment
  src/lib/tasking.ts      mission task, maneuver impact, fleet screening, re-tasking
  src/lib/safetyGate.ts   the five safety-gate checks
  src/lib/proposals.ts    proposal store, authority decisions, verification
  src/lib/auth.ts         roles, permissions, credential check, session tokens
  src/routes/api.ts       HTTP surface
  src/routes/auth.ts      login / me / logout
  src/routes/authMiddleware.ts  attachUser, requireAuth, requirePermission

frontend/               React + Vite + CesiumJS
  src/components/globe/   CesiumGlobe — all 3D entity construction
  src/components/bplane/  B-plane projection (SVG)
  src/components/panels/  analyst controls, conjunction details, TCA info, safety gate,
                          risk calculation + before/after comparison
  src/components/tasking/ mission continuity: impact, transfer flow, fleet table, timeline
  src/components/auth/    ProtectedRoute
  src/components/timeline/simulation timeline + playback
  src/pages/              Conjunctions (workspace), Maneuver Lab, Mission Continuity,
                          Authority Console, and the auth pages
  src/state/AppState.tsx  shared simulation clock, display toggles, workflow state
  src/state/AuthContext.tsx  session, role, permissions
```

### How the physics is actually done

**Orbit seeding uses SGP4.** `satellite.js` propagates fabricated-but-valid TLEs to
produce the initial state vectors, so the orbits have real LEO characteristics.

**Maneuver response uses a two-body propagator.** A Δv applied mid-flight cannot be
re-expressed as a TLE without a full osculating-to-mean element fit, so once the operator
burns, the proposed and verified trajectories are propagated with the universal-variable
Kepler solver in `kepler.ts`. No J2, drag, or third-body — a documented trade-off for a
prototype whose goal is *convincing orbital behaviour*, not ephemeris accuracy.

**The conjunction geometry is constructed, then measured.** Rather than hoping randomised
elements happen to produce a close approach, the threat's state at TCA is built
analytically from the primary's: a miss vector orthogonal to the relative velocity, so
TCA is an exact local range minimum. Everything downstream — TCA search, miss distance,
B-plane, Pc, maneuver response — is then computed for real from that state.

**Pc uses a standard method on synthetic inputs.** The collision probability is the 2D
Gaussian integrated over the hard-body disk in the B-plane, on a polar grid. The *method*
is the real one; the covariance feeding it is fabricated, because ORION has no orbit
determination pipeline. Reported values are floored at 1e-8: past roughly 6σ a Gaussian
tail produces numbers like 1e-50 that are an artifact of assuming the covariance is
exactly right, and operational practice does not report them.

### Performance

Per the prototype's priorities — clarity and responsiveness over object count:

- The simulation clock updates at ~12 Hz rather than per animation frame, bounding React
  re-renders across every consumer of the shared state.
- Trajectories are sampled server-side at 60 s for the primary and threat, 300 s for the
  background field.
- Labels are suppressed by default: only the primary, the designated threat, high-risk
  objects and the selected object are labelled, unless the analyst enables object names.
- The detailed CubeSat model (body + solar panels) is behind a distance-display condition
  and only renders in close-range views.

---

## API

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/scenario` | scenario metadata, epoch, TCA, object list |
| `GET` | `/api/trajectory/:objectId` | propagated samples (`startSec`, `endSec`, `stepSec`) |
| `GET` | `/api/nearby?atSec=` | tracked objects with range, relative velocity, risk |
| `GET` | `/api/conjunction/current` | the active conjunction assessment |
| `POST` | `/api/maneuver/simulate` | before/after assessment + proposed trajectory + gate |
| `POST` | `/api/proposals` | submit a proposal for authority review |
| `GET` | `/api/proposals` · `/api/proposals/:id` | list / fetch proposals |
| `POST` | `/api/proposals/:id/decision` | `APPROVE` / `REQUEST_REVISION` / `REJECT` |
| `POST` | `/api/proposals/:id/verify` | post-approval verification + secondary screening |

Proposals are held in memory — restarting the server clears them, which is the right
scope for a demo.
