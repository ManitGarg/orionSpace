# ORION — Technology Stack

A complete, code-verified inventory of what this project is actually built with.
Everything below was determined by reading the source, the two `package.json`
files and both `package-lock.json` files — not by trusting declarations. Where a
library is listed, it is because it is genuinely imported and exercised.

**Scope:** 57 files, ~11,000 lines, two applications (`frontend/`, `server/`).

---

## Headline

ORION is a **two-process TypeScript project** — a React/Vite/CesiumJS single-page
app talking to an Express API over REST.

There is **no database, no ORM, no cloud service, no AI/ML, no third-party API
(except one optional imagery CDN), no tests, no CI and no deployment
configuration.** The dependency surface is deliberately tiny — **7 runtime
packages across both applications** — because the substance of the project is
hand-written orbital mechanics, not glue over libraries.

---

## 1. Frontend

| Concern | What is actually there |
| --- | --- |
| Framework | **React 18.3.1** (declared `^18.3.1`, lock-resolved 18.3.1) |
| Language | **TypeScript 5.9.3** (declared `^5.5.3`), `strict: true`, `jsx: react-jsx`, ESM (`"type": "module"`) |
| Build tool | **Vite 5.4.21** (declared `^5.3.4`) with `@vitejs/plugin-react` 4.7.0 (Babel-based HMR) |
| Cesium integration | **`vite-plugin-cesium` 1.2.23** — copies Cesium's static assets and workers, sets `CESIUM_BASE_URL` |
| CSS solution | **Hand-written plain CSS**, one file: `frontend/src/styles/global.css` (636 lines). No Tailwind, no CSS Modules, no Sass, no CSS-in-JS. Design tokens as CSS custom properties on `:root`, plus inline `style={{}}` for one-off layout |
| UI / component library | **None.** Every panel, table, badge and card is bespoke |
| State management | **React Context + `useState`.** Two providers: `AuthContext.tsx` (session, role, permissions) and `AppState.tsx` (~30-field simulation store: clock, playback speed, display toggles, camera mode, trajectory mode, workflow results). No Redux / Zustand / Jotai / MobX |
| Routing | **react-router-dom 6.30.6**, using **`HashRouter`** (`App.tsx:2`) — hash-based so the built bundle can be served from any static host with no rewrite rules. 10 routes behind a custom `<ProtectedRoute allow={...}>` |
| Forms | **No library.** Controlled `<input>` elements and one native `<form onSubmit>` in `LoginPage.tsx`. Numeric and range inputs in `ManeuverLabPage`, `AnalystControlPanel`, `SimulationTimeline` |
| Form validation | **None.** Only `disabled={busy \|\| !id \|\| !password}` on the login button. No Zod / Yup / React Hook Form |
| API / data fetching | **Native `fetch`**, wrapped in `frontend/src/api/client.ts` (131 lines): a typed `api` object, `Bearer` header injection, a custom `ApiError` carrying the HTTP status, and a global 401 handler. No axios, no TanStack Query, no SWR. Caching is `useState` + `useEffect` |
| Animation | **No library.** A throttled `requestAnimationFrame` playback loop in `AppState.tsx:130-149` (~12 Hz, deliberately not per-frame, to bound React re-renders across every consumer of the shared context) plus two CSS `transition` rules |
| Icons | **None.** Unicode glyphs — `▲ ◆ ■ ●` for object types (`CesiumGlobe.tsx:59-70`), plus `←`, `·`, `σ`, `Δ` |
| Charts / visualization | **Two custom renderers, no chart library.** (a) **CesiumJS 1.144.0** for the 3D globe — 891 lines in `CesiumGlobe.tsx`; (b) **hand-written inline SVG** for the B-plane encounter projection (`BPlaneView.tsx`, 113 lines: 1σ/2σ/3σ covariance ellipses, miss vector with an SVG `<marker>` arrowhead, hard-body disk) |
| Other notable | `frontend/src/lib/orbit.ts` — Cesium-side helpers: `SampledPositionProperty` in `ReferenceFrame.INERTIAL` with degree-3 Lagrange interpolation, km→`Cartesian3` conversion, RTN rotation matrices, `Pc` formatting |

### The 3D layer in detail

`CesiumGlobe.tsx` uses: `Cesium.Viewer` with every default widget disabled;
`SampledPositionProperty` trajectories; `VelocityOrientationProperty` for
attitude; `CallbackPositionProperty` for the procedurally placed solar panels;
`PolylineGlowMaterialProperty` / `PolylineDashMaterialProperty` to distinguish
current from proposed tracks; `DistanceDisplayCondition` level-of-detail (the
detailed CubeSat model renders only inside 400 km camera range); ellipsoid
wireframes for covariance; graded-alpha shells for the risk heatmap; and
`ScreenSpaceEventHandler` `LEFT_CLICK` picking.

---

## 2. Backend

| Concern | What is actually there |
| --- | --- |
| Language | **TypeScript 5.9.3**, compiled to ESM (`module: NodeNext`, `target: ES2022`, `strict: true`) |
| Runtime | **Node.js** — no version pinned anywhere (no `.nvmrc`, no `engines` field). `@types/node` `^20.14.9` implies Node 20 |
| Framework | **Express 4.22.2** (declared `^4.19.2`) |
| Framework style | Two `express.Router()` instances (`api`, `authRoutes`) mounted at `/api` and `/api/auth` |
| API architecture | **REST over JSON.** 14 endpoints plus `/api/health`. **No GraphQL, no WebSocket, no SSE, no gRPC** — the "live" timeline is simulated client-side, not streamed |
| Server | Express's built-in `app.listen(PORT ?? 4000)`. No Nginx, no reverse proxy config, no clustering |
| Middleware | Three, in order: `cors()` (**default configuration — `Access-Control-Allow-Origin: *`**), `express.json()`, and the custom `attachUser` (resolves a session for every request but never rejects). Then per-route `requirePermission(...)` guards |
| ORM / query builder | **None — no database exists** |
| Validation | **No library.** Hand-rolled coercion: `Number(body.burnOffsetSec)` with a `Number.isFinite` check, `String(id ?? "")`, and an allowlist check on the decision enum. `parseManeuverInput(body: any)` is untyped at the boundary |
| Authentication | Custom — see §4 |
| Authorization | Custom permission-string RBAC — see §4 |
| Background jobs | **None.** No queue, no cron, no worker threads. Everything is synchronous request-time computation |
| Caching | One module-level singleton: `let cached: Scenario \| null` (`scenario.ts:74`) — the scenario is built on first request and reused for the process lifetime, which is what keeps `epoch0 = new Date()` stable. No Redis, no HTTP cache headers |
| Logging | **None.** A single `console.log` on listen. No Winston / Pino / Morgan, no request logging |
| Error handling | **No global error middleware.** Per-route `res.status(4xx).json({ error })` only; an unhandled throw would surface as Express's default 500 HTML |

### The computational core

`server/src/lib/` is ~1,600 lines of physics and decision logic, all
hand-written. This is where the project's real weight sits:

| Module | What it does |
| --- | --- |
| `kepler.ts` | Two-body propagation via the **universal-variable (Stumpff C/S) Kepler solver** with Newton iteration; RTN frame construction; Δv application; vector primitives |
| `tle.ts` | **SGP4 via `satellite.js`**, plus a synthetic-but-checksum-valid TLE generator that seeds the demo objects with realistic LEO characteristics |
| `conjunction.ts` | TCA search — a coarse 400-step scan followed by a 40-iteration ternary refine |
| `covariance.ts` | B-plane basis construction, combined 2×2 covariance, and **collision probability by numerical polar-grid integration of a 2D Gaussian over the hard-body disk** (60 radial × 90 angular steps), floored at `PC_FLOOR = 1e-8` |
| `risk.ts` | `R = Pc × C`, with `C` decomposed into an asset-loss baseline, a `log₁₀` collision-energy term, and an altitude-based debris-persistence term |
| `maneuver.ts` | Before/after conjunction assessment with trajectory re-anchoring |
| `safetyGate.ts` | Five checks resolving to `CLEARED` / `FLAGGED` / `BLOCKED` |
| `tasking.ts` | Mission continuity: attitude-outage model (slew + burn-time-per-m/s + settle), ground-track displacement against sensor swath, fleet screening, re-tasking |
| `proposals.ts` | Proposal lifecycle plus post-approval verification with a simulated ±3% Δv execution error |

---

## 3. Database

**There is no database.** No SQL, no NoSQL, no SQLite file, no ORM, no
migrations, no seed scripts, no connection string. Neither `.env.example`
references a datastore.

Persistence is **three in-process JavaScript structures**, all lost on restart:

| Store | Location | Contents | Lifetime |
| --- | --- | --- | --- |
| `sessions` | `server/src/lib/auth.ts:88` — `Map<string, { user, expiresAt }>` | Active login sessions, 12 h TTL | Process |
| `store` | `server/src/lib/proposals.ts:46` — `Map<string, Proposal>` | Maneuver proposals, decisions, verification | Process |
| `cached` | `server/src/lib/scenario.ts:74` | The generated scenario singleton | Process |

Client-side there is one `localStorage` key: `orion.auth.token`
(`api/client.ts:22`), wrapped in `try/catch` for private-browsing mode.

### "Models" — TypeScript interfaces only, no persistence layer

`TrackedObject`, `Scenario`, `StateVector`, `Covariance2x2`, `BPlaneFrame`,
`ConjunctionResult`, `RiskScore`, `ManeuverInput`, `ManeuverSimulationResult`,
`SafetyGateResult`, `Proposal`, `MissionTask`, `TaskImpact`,
`CandidateEvaluation`, `TaskingAssessment`, `AuthUser`, `Session`.

### Relationships

Object-graph, not relational. `Scenario` has 1→1 `primary` and `threat` and 1→N
`nearby[]`. `Proposal` embeds 1→1 a `ManeuverSimulationResult` (which itself
embeds `before` / `after` `ConjunctionResult`s), a `SafetyGateResult`, a
`TaskingAssessment` and an optional `verification` block. Proposals deliberately
**snapshot** the full simulation at submission time, so the authority reviews
exactly what the operator saw.

### Seed data

Hardcoded in `scenario.ts`: `MUJ-CubeSat-01` (primary, 12 kg 6U CubeSat, ~550 km
sun-synchronous at 97.45° inclination), `DEB-47291` (designated threat, 140 kg),
and eight background objects (`SAT-11042`, `SAT-20388`, `RB-30877`, `DEB-19023`,
`DEB-55210`, `INACT-08871`, `SAT-40219`, `DEB-63102`). The re-tasking fleet
(`SAT-B` / `SAT-C` / `SAT-D`) is hardcoded in `tasking.ts:139`.

---

## 4. Authentication & Security

Entirely **custom, ~170 lines**. No auth library.

### The flow

```
1. GET  #/login                       → RoleSelectPage: OPERATOR or AUTHORITY
2. GET  #/login/operator|authority    → LoginPage (role baked into the page)
3. POST /api/auth/login {id, password, role}
     ↓ lib/auth.ts :: login()
     - normalize id (trim + lowercase), look up in credentials()
     - timingSafeEqual() password compare        ← constant-time, but PLAINTEXT
     - reject if record.role !== expectedRole    ← operator creds on the authority page fail
     - sessionId = randomBytes(24).toString("hex")
     - sessions.set(sessionId, { user, expiresAt: now + 12h })
     - token = `${sessionId}.${HMAC-SHA256(sessionId, SESSION_SECRET)}`
     ↓ 200 { token, user, permissions[] }
     ↓ 401 { "invalid credentials for this role" }   ← uniform message
4. Client: setAuthToken() → localStorage["orion.auth.token"] + in-memory variable
5. Every request: Authorization: Bearer <token>
     ↓ attachUser (global) → verifyToken (HMAC re-derive + timingSafeEqual)
                           → Map lookup → TTL check → req.user
6. Route guard: requirePermission("maneuver:propose")
     - no req.user           → 401 "authentication required"
     - role lacks permission → 403 "forbidden: role X does not hold permission Y"
7. Page reload: AuthContext calls GET /api/auth/me
     — the server, not the stored token, is the authority on validity
8. Any 401 anywhere → client clears token and state → guards redirect to the
   role's login page
9. POST /api/auth/logout → sessions.delete(sessionId)
```

### Mechanism by mechanism

| Mechanism | Status |
| --- | --- |
| Login / signup | **Login only.** No signup, no password reset, no account management. Two fixed accounts |
| Sessions | **Server-side, in-memory `Map`**, 12 h TTL, opaque 24-byte random session id |
| JWT | **No.** The token is `sessionId.HMAC-SHA256(sessionId)` and carries **no claims**, so revocation is real — deleting the `Map` entry kills it. Structurally similar to a JWT, but not one |
| OAuth / Google / GitHub / SSO | **None** |
| Password hashing | **None.** Passwords are compared in plaintext via `timingSafeEqual` — constant-time, so no timing oracle, but no bcrypt / argon2 / scrypt. Credentials come from environment variables with **hardcoded demo fallbacks** (`auth.ts:57-72`) |
| Cookies | **Not used.** Bearer header plus `localStorage` |
| Roles | **Two** — `OPERATOR`, `AUTHORITY` |
| RBAC | **Yes**, permission-string based (`ROLE_PERMISSIONS`, `auth.ts:31`), seven permissions each, **deliberately disjoint on the decision boundary**: the operator holds `maneuver:simulate` and `maneuver:propose` but not `proposal:decide`; the authority holds `proposal:decide` and `proposal:verify` but not `maneuver:simulate`. Enforced **twice** — React route guards for navigation, and server-side `requirePermission` so a crafted request cannot bypass the UI |
| CORS | **`cors()` with defaults → `Access-Control-Allow-Origin: *`**, all origins. Tolerable only because auth is Bearer-based with no cookies |
| CSRF | **No protection, and none required** — no cookie or ambient credentials, so a cross-site form post carries no token |
| Rate limiting | **None.** `/api/auth/login` is unthrottled and brute-forceable |
| Input validation | **Minimal** — see §2. No schema validation anywhere |
| API keys | One, optional, client-side: `VITE_CESIUM_ION_TOKEN` |
| Secrets | Six environment variables, all server-side, all with fallbacks: `ORION_OPERATOR_ID` / `_PASSWORD` / `_NAME`, `ORION_AUTHORITY_ID` / `_PASSWORD` / `_NAME`, `ORION_SESSION_SECRET` (random per boot if unset, so a restart invalidates every session) and `PORT`. `.env` is gitignored; only `.env.example` files are committed. **No secret reaches the client bundle** |

### Posture

The design decisions are deliberate and documented: a uniform 401 message that
leaks neither id-existence nor role mismatch; the 403-versus-401 distinction so
the UI can say "wrong role" instead of "log in"; constant-time comparison;
server-side revalidation on reload.

The gaps — plaintext passwords, no rate limiting, wildcard CORS, no schema
validation — are the ones to close before this touches anything real.

---

## 5. APIs & Third-Party Services

**Verified by code inspection, not by dependency listing.** Searching both `src`
trees for `fetch(`, `http://`, `https://` and `axios` returns **only the two
`fetch` calls to the application's own `/api`**. The server makes **zero
outbound network calls**.

| Service | What it does | Where / how used | Status |
| --- | --- | --- | --- |
| **Cesium ion** (ion.cesium.com) | High-resolution world imagery and terrain tiles | `CesiumGlobe.tsx:77-95` — only when `VITE_CESIUM_ION_TOKEN` is set. Sets `Cesium.Ion.defaultAccessToken`, then calls `createWorldImageryAsync()` / `createWorldTerrainAsync()` inside a `try`/`catch` that falls back to **Cesium's bundled offline Natural Earth II** imagery on any failure | **Optional, opt-in, gracefully degrading.** The app is fully functional with no account and no network |

### Confirmed absent

No AI or LLM API (no Anthropic, OpenAI, Gemini, Hugging Face), no ML library (no
TensorFlow.js, no ONNX), no payment gateway, no email service, no SMS, no maps
API (Google, Mapbox), no cloud storage (S3, GCS, Blob), no external auth
provider, no analytics or telemetry (no GA, Segment, PostHog, Sentry), no
Firebase, no Supabase, no AWS / GCP / Azure SDK, no Space-Track / CelesTrak /
NORAD feed, no feature flags, and no CDN beyond the optional ion tiles.

### A note on the orbital data

Despite being a space-domain application, ORION pulls **no real catalog data**.
TLEs are fabricated in `tle.ts :: buildTLE()` with valid checksums, and the
conjunction geometry is *constructed analytically* — a miss vector forced
orthogonal to the relative velocity so that TCA is an exact local range
minimum — rather than discovered from real ephemerides. Every screen carries a
`DEMO / SIMULATED` badge.

---

## 6. UI / Design Stack

| Layer | What |
| --- | --- |
| UI framework | React 18 function components and hooks. Zero class components |
| Component library | **None** — fully bespoke |
| CSS framework | **None** — one 636-line hand-written stylesheet |
| Design system | Informal but consistent: a CSS custom-property token set on `:root` — four background steps (`--bg-0`…`--bg-3`), two borders, three text tiers (`--text-hi` / `--text-mid` / `--text-low`), `--accent` (`#4fa8ff`), `--good`, and four semantic risk colours (`--risk-safe` / `-moderate` / `-high` / `-critical`). Reused across the CSS and mirrored in TypeScript by `riskColorHex()` (`RiskBadge.tsx`), so 3D entity colours match the CSS badges |
| Reusable primitives | `.panel`, `.panel-title`, `.card`, `.kv-row`, `.risk-pill`, `.check-row`, `.proposal-row`, `.demo-badge`, `.mono`, `.section-label`, `.loading-screen`, `.auth-card` |
| Fonts | **System stacks only — no webfont is loaded.** `--sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, Roboto, sans-serif`; `--mono: "SF Mono", "JetBrains Mono", ui-monospace, Menlo, Consolas, monospace`. Inter and JetBrains Mono are *named* but used only if locally installed. Base size 13px — dense and deliberately console-like |
| Icons | Unicode glyphs only |
| Animations | CSS `transition` on buttons; the rAF playback loop; Cesium's own scene rendering (FXAA, fog, ground atmosphere and lighting all enabled) |
| Charts | Custom SVG (B-plane) and Cesium (3D). No library |
| Theme / dark mode | **Dark-only, hard-committed.** No light palette, no `prefers-color-scheme`, no toggle. Deep navy-black (`#05070b`) mission-console aesthetic |
| Responsive design | **Desktop-first, effectively desktop-only.** `body { overflow: hidden }`, a `100vh` / `100vw` CSS Grid shell, and exactly **one** media query (`@media (max-width: 900px)`, `global.css:631`). Not built for mobile |
| Layout | CSS Grid for the app shell (44px topbar plus body; nav sidebar plus main), flexbox within panels, absolutely positioned floating panels over the Cesium canvas |

---

## 7. Dependencies

### Frontend — `frontend/package.json`

Four runtime, six dev. Lockfile v3, 182 packages resolved.

**Runtime — all four genuinely used:**

| Package | Declared / resolved | Purpose | Used |
| --- | --- | --- | --- |
| `cesium` | `^1.120.0` / **1.144.0** | The entire 3D globe: viewer, entities, sampled positions, materials, picking, camera flights | ✅ `CesiumGlobe.tsx`, `lib/orbit.ts` |
| `react` | `^18.3.1` / 18.3.1 | UI runtime | ✅ everywhere |
| `react-dom` | `^18.3.1` / 18.3.1 | `createRoot` in `main.tsx` | ✅ |
| `react-router-dom` | `^6.25.1` / **6.30.6** | `HashRouter`, `Routes`, `NavLink`, `Navigate`, `useNavigate`, `useLocation` | ✅ 11 imports |

**Dev — all six genuinely used:** `typescript` 5.9.3, `vite` 5.4.21,
`@vitejs/plugin-react` 4.7.0, `vite-plugin-cesium` 1.2.23, `@types/react`
18.3.x, `@types/react-dom` 18.3.x.

### Backend — `server/package.json`

Three runtime, five dev. Lockfile v3, 115 packages resolved.

| Package | Declared / resolved | Purpose | Used |
| --- | --- | --- | --- |
| `express` | `^4.19.2` / **4.22.2** | HTTP server, routing, JSON body parsing | ✅ |
| `cors` | `^2.8.5` / **2.8.6** | Cross-origin headers (default wildcard configuration) | ✅ `index.ts:8` |
| `satellite.js` | `^5.0.0` / 5.0.0 | **SGP4** — `twoline2satrec`, `propagate`, `gstime`, `eciToGeodetic`, `degreesLat` / `degreesLong`. Seeds every orbit from synthetic TLEs and converts ECI→geodetic for the ground-track and swath math | ✅ `tle.ts`, consumed by `scenario.ts` and `tasking.ts` |

**Dev:** `typescript` 5.9.3, `tsx` 4.23.12 (dev runner with watch),
`@types/node` 20.19.43, `@types/express`, `@types/cors`. All used.

**Node built-ins:** `node:crypto` — `createHmac`, `randomBytes`,
`timingSafeEqual`, `randomUUID`.

### Installed but unused

**None.** Every declared dependency in both `package.json` files is genuinely
imported and exercised. There is no cruft.

### Dead code — not dead dependencies

Four exported symbols have zero call sites:

- `requireRole()` — `server/src/routes/authMiddleware.ts:56`, superseded by the finer-grained `requirePermission`
- `interpolateSamples()` — `frontend/src/lib/orbit.ts:34`, since Cesium's own interpolation covers it
- `formatKm()` — `frontend/src/lib/orbit.ts:70`
- `riskReductionPercent()` — `server/src/lib/risk.ts:117`

---

## 8. Development & Tooling

| Tool | Status |
| --- | --- |
| Package manager | **npm** — `package-lock.json` v3 in both applications. No pnpm / yarn / bun lockfile. **No workspaces** — two independent `npm install`s |
| Node version | **Not pinned.** No `.nvmrc`, no `engines`. Node 20 inferred from `@types/node` `^20` and the `--env-file` guidance in `server/.env.example` |
| TypeScript | ✅ Both applications, `strict: true`. Frontend uses `noEmit` and `moduleResolution: bundler`; the server emits to `dist/` with sourcemaps under `moduleResolution: NodeNext`. `noUnusedLocals` / `noUnusedParameters` are **off** in the frontend |
| ESLint | ❌ **Not installed.** No config file, zero `eslint` entries in either lockfile — yet the source contains **13 `// eslint-disable-*` comments** (`react-hooks/exhaustive-deps`, `no-console`, `@typescript-eslint/no-namespace`), written for a linter that was never wired up |
| Prettier | ❌ No config, not installed. Formatting is consistent by hand — two-space indent, double quotes, trailing commas |
| Testing | ❌ **Zero tests.** No Vitest / Jest / Playwright / Cypress, no `*.test.*` or `*.spec.*` files, no `test` script. Notable, since the numerical core (Kepler solver, Pc integration, TCA search) is exactly what benefits most from unit tests |
| Type checking | ✅ `npm run typecheck` in both applications |
| Git | ✅ Git and GitHub. `.gitignore` covers `node_modules/`, `dist/`, `build/`, `*.tsbuildinfo`, `.env*`, logs, `.DS_Store`, `.vscode/`, `.idea/` |
| Husky / lint-staged | ❌ None. No `.husky/`, no git hooks |
| CI/CD | ❌ **None.** There is no `.github/` directory |
| Docker / Compose | ❌ **None.** No Dockerfile, no `.dockerignore`, no compose file |
| Developer experience | Vite HMR on `:5173` with a `/api` → `localhost:4000` proxy; `tsx watch` on the server; `window.__orionViewer` exposed in DEV for Cesium console debugging (`CesiumGlobe.tsx:151`) |

### Scripts

- **frontend:** `dev`, `build` (`tsc -b && vite build`), `preview`, `typecheck`
- **server:** `dev` (`tsx watch`), `build` (`tsc`), `start` (`node dist/index.js`), `typecheck`

---

## 9. Deployment & Infrastructure

### Confirmed from code and configuration

- **Local development only.** The only runtime configuration that exists is the
  Vite dev server on port 5173 with a `/api` proxy to `http://localhost:4000`
  (`vite.config.ts`), and `PORT ?? 4000` on the server.
- **Two separate processes**, with no orchestration between them.
- **Environment configuration** via `.env.example` files. The server is designed
  for Node's **native `--env-file`** loader
  (`node --env-file=.env dist/index.js`) — there is no `dotenv` dependency.
- **Build outputs:** frontend → `dist/` static bundle (Vite / Rollup 4.62.5,
  esbuild 0.21.5); server → `dist/` ESM.
- **`HashRouter` is a deployment-relevant choice** — the built frontend is a pure
  static bundle needing no SPA rewrite rules from whatever serves it.

### Confirmed absent

No Vercel, Netlify, Render, Railway, Fly, Heroku, AWS, Azure, GCP, Firebase,
Supabase or Cloudflare configuration. No Docker, no Kubernetes, no GitHub
Actions, no Nginx or Caddy config, no serverless function directory, no
`Procfile`, no PM2 or systemd unit, and no health-check wiring beyond the
`/api/health` endpoint itself — which exists but nothing consumes it.

### Suspected or inferred only

- **Node 20+** as the target runtime, from `@types/node` and the `--env-file`
  flag, which requires Node ≥ 20.6.
- The README describes only the two-terminal local workflow; **there is no
  evidence this has been deployed anywhere.** As a prototype with in-memory
  state, a single-instance deploy is the only shape that would work — horizontal
  scaling would break both the session store and the proposal store, since
  neither is shared.
- Deploying it would require a static host for `frontend/dist` and a Node host
  for the server, plus either a reverse proxy mapping `/api` or a CORS-scoped
  absolute API base — the client currently hardcodes the relative
  `const BASE = "/api"`.

---

## 10. Project Architecture

```
orion_space/
├── README.md                        workflow, roles, demo path, physics rationale
├── TECH_STACK.md                    this document
├── .gitignore
├── frontend/                        React + Vite + CesiumJS SPA
│   ├── index.html                   single mount point (#root)
│   ├── vite.config.ts               react + cesium plugins, :5173, /api proxy
│   ├── tsconfig.json                strict, bundler resolution, react-jsx
│   ├── .env.example                 VITE_CESIUM_ION_TOKEN (optional)
│   └── src/
│       ├── main.tsx                 createRoot + StrictMode
│       ├── App.tsx                  AuthProvider > HashRouter > Routes;
│       │                              ScenarioGate; AppShell
│       ├── api/
│       │   ├── client.ts            ← the ONLY network boundary: fetch wrapper,
│       │   │                          ApiError, Bearer injection, token storage,
│       │   │                          401 handler
│       │   └── types.ts             DTOs mirroring the server's serializers
│       ├── state/
│       │   ├── AuthContext.tsx      session, role, permissions, can(), signIn/Out
│       │   └── AppState.tsx         simulation clock, playback, display toggles,
│       │                              camera/view/trajectory modes, workflow state
│       ├── lib/orbit.ts             Cesium math helpers + formatters
│       │                              (mirrors the server's PC_FLOOR)
│       ├── styles/global.css        the entire design system
│       ├── components/
│       │   ├── layout/Shell.tsx     topbar + role-filtered nav + main
│       │   ├── auth/ProtectedRoute  three-outcome guard: login / own-home / render
│       │   ├── globe/CesiumGlobe    891 lines — all 3D entity construction
│       │   ├── bplane/BPlaneView    hand-drawn SVG encounter-plane projection
│       │   ├── panels/              AnalystControl, ConjunctionDetails, TCAInfo,
│       │   │                          RiskCalculation, SafetyGate, CameraControls
│       │   ├── tasking/MissionContinuity
│       │   │                        impact card, transfer flow, fleet table, timeline
│       │   ├── timeline/SimulationTimeline
│       │   │                        playback scrubber + speed control
│       │   └── common/RiskBadge     RiskBadge, DemoBadge, riskColorHex
│       │                              (the shared colour source of truth)
│       └── pages/                   Overview, Satellites, Conjunctions (the
│                                      workspace), Space, ManeuverLab,
│                                      MissionContinuity, Proposals,
│                                      auth/RoleSelect, auth/Login
└── server/                          Express + TypeScript API
    ├── tsconfig.json                NodeNext ESM, emits to dist/
    ├── .env.example                 six credential/session vars, all with fallbacks
    └── src/
        ├── index.ts                 wiring: cors → json → attachUser → routes → listen
        ├── routes/
        │   ├── api.ts               11 endpoints + DTO serializers
        │   ├── auth.ts              login / me / logout
        │   └── authMiddleware.ts    attachUser, requireAuth, requirePermission,
        │                              requireRole
        └── lib/                     ← the domain core; zero Express coupling,
            │                          fully testable as-is
            ├── kepler.ts            universal-variable propagator, RTN frame, Δv
            ├── tle.ts               SGP4 (satellite.js) + synthetic TLE generation
            ├── covariance.ts        B-plane basis, combined covariance, Pc integration
            ├── conjunction.ts       TCA search + full assessment
            ├── risk.ts              R = Pc × C with consequence breakdown
            ├── maneuver.ts          before/after simulation, trajectory re-anchoring
            ├── safetyGate.ts        five checks → CLEARED / FLAGGED / BLOCKED
            ├── tasking.ts           attitude outage, ground track, fleet screening
            ├── trajectory.ts        epoch-relative sampling
            ├── scenario.ts          the constructed demo scenario (cached singleton)
            └── auth.ts              roles, permissions, credentials, HMAC sessions
```

### On the layering

The separation is genuinely clean: `routes/` contains no physics, and `lib/`
contains no Express types. Every route handler is a thin serializer over a pure
domain function. `lib/` could be lifted into a package, or unit-tested as it
stands, with no refactoring — which makes the total absence of tests the most
conspicuous gap in the project.

### Architecture diagram

```
                              USER
                    (Operator  |  Authority)
                               ↓
╔══════════════════════════════════════════════════════════════════════╗
║  FRONTEND — React 18 + TypeScript + Vite 5   (SPA, static bundle)     ║
║                                                                      ║
║   HashRouter ──→ ProtectedRoute(allow) ──→ Shell ──→ Pages           ║
║        │                                                             ║
║   ┌────┴─────────────────┬──────────────────────────┐                ║
║   │ AuthContext          │ AppState                 │                ║
║   │ user/role/perms      │ clock · playback · modes │                ║
║   │ localStorage token   │ display · workflow state │                ║
║   └────┬─────────────────┴──────────┬───────────────┘                ║
║        │                            ↓                                ║
║        │              ┌─────────────────────────────┐                ║
║        │              │  CesiumJS 1.144 (WebGL 3D)  │                ║
║        │              │  SVG B-plane · Custom CSS   │                ║
║        │              └─────────────────────────────┘                ║
╚════════│═════════════════════════════════════════════════════════════╝
         ↓  api/client.ts — native fetch · Authorization: Bearer <token>
         ↓  (dev: Vite proxy :5173 → :4000)
╔══════════════════════════════════════════════════════════════════════╗
║  API / BACKEND — Express 4 + TypeScript ESM on Node 20   (:4000)     ║
║                                                                      ║
║   cors(*) → express.json() → attachUser → requirePermission(...)     ║
║                                                                      ║
║   /api/auth/login · me · logout      /api/scenario · trajectory ·    ║
║   /api/maneuver/simulate               nearby · conjunction/current ·║
║   /api/proposals[/:id/decision|verify] tasking/active · health       ║
╚══════════════════════════════════════════════════════════════════════╝
         ↓
╔══════════════════════════════════════════════════════════════════════╗
║  BUSINESS LOGIC — server/src/lib/  (pure TS, no framework coupling)  ║
║                                                                      ║
║   scenario ─→ tle(SGP4) ─→ kepler(universal-variable propagator)     ║
║       ↓                          ↓                                   ║
║   conjunction(TCA search) ─→ covariance(B-plane, Pc integration)     ║
║       ↓                          ↓                                   ║
║   risk (R = Pc × C) ─→ maneuver(before/after) ─→ safetyGate(5 checks)║
║       ↓                          ↓                                   ║
║   tasking(attitude outage, ground track, fleet screening)            ║
║       ↓                                                              ║
║   proposals(lifecycle: PENDING → APPROVED → VERIFIED)                ║
╚══════════════════════════════════════════════════════════════════════╝
         ↓
╔══════════════════════════════════════════════════════════════════════╗
║  "DATABASE" — NONE. In-process, volatile, lost on restart.           ║
║    Map<sessionId, Session>      Map<proposalId, Proposal>            ║
║    cached Scenario singleton  │  client: localStorage[token]         ║
╚══════════════════════════════════════════════════════════════════════╝
         ↓
╔══════════════════════════════════════════════════════════════════════╗
║  EXTERNAL SERVICES — essentially none.                               ║
║    Cesium ion imagery/terrain  ← OPTIONAL, token-gated, falls back   ║
║                                  to bundled offline Natural Earth II ║
║    Server outbound calls: ZERO                                       ║
╚══════════════════════════════════════════════════════════════════════╝
```

---

## Summary

- **Frontend** — React 18 + TypeScript 5 + Vite 5 + CesiumJS 1.144, hand-written
  CSS, Context-only state, `HashRouter`, native `fetch`. Four runtime
  dependencies.
- **Backend** — Node 20 + TypeScript ESM + Express 4 + `satellite.js` (SGP4).
  Three runtime dependencies. All the real weight is ~1,600 lines of
  hand-written orbital mechanics.
- **Database** — none; three in-memory `Map`s.
- **Auth** — custom HMAC-signed opaque session tokens, plaintext environment-variable
  credentials, two-role RBAC enforced on both client and server.
- **External services** — one, optional (Cesium ion imagery). No AI/ML, no cloud,
  no analytics.
- **Tooling** — npm and `tsc` only. No lint, no formatter, no tests, no CI, no
  Docker, no deployment configuration.
