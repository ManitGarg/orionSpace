import React from "react";
import { HashRouter, Navigate, Route, Routes } from "react-router-dom";
import { AppStateProvider, useAppState } from "./state/AppState";
import { AuthProvider, HOME_ROUTE, useAuth } from "./state/AuthContext";
import { ProtectedRoute } from "./components/auth/ProtectedRoute";
import { Shell } from "./components/layout/Shell";
import { OverviewPage } from "./pages/OverviewPage";
import { SatellitesPage } from "./pages/SatellitesPage";
import { ConjunctionsPage } from "./pages/ConjunctionsPage";
import { SpacePage } from "./pages/SpacePage";
import { ManeuverLabPage } from "./pages/ManeuverLabPage";
import { ProposalsPage } from "./pages/ProposalsPage";
import { MissionContinuityPage } from "./pages/MissionContinuityPage";
import { RoleSelectPage } from "./pages/auth/RoleSelectPage";
import { LoginPage } from "./pages/auth/LoginPage";

/** Blocks the app shell until the scenario has loaded. */
function ScenarioGate({ children }: { children: React.ReactNode }) {
  const { loading, error } = useAppState();
  if (error) {
    return (
      <div className="loading-screen">
        <div>Could not reach the ORION backend API.</div>
        <div className="mono" style={{ color: "var(--text-low)" }}>{error}</div>
      </div>
    );
  }
  if (loading) {
    return <div className="loading-screen">Loading scenario…</div>;
  }
  return <>{children}</>;
}

/** Everything inside the authenticated app shares the shell and the scenario. */
function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <AppStateProvider>
      <ScenarioGate>
        <Shell>{children}</Shell>
      </ScenarioGate>
    </AppStateProvider>
  );
}

/** Sends an already-signed-in user to their own console instead of a login form. */
function RedirectIfSignedIn({ children }: { children: React.ReactNode }) {
  const { user, initializing } = useAuth();
  if (initializing) return <div className="loading-screen">Restoring session…</div>;
  if (user) return <Navigate to={HOME_ROUTE[user.role]} replace />;
  return <>{children}</>;
}

function RootRedirect() {
  const { user, initializing } = useAuth();
  if (initializing) return <div className="loading-screen">Restoring session…</div>;
  return <Navigate to={user ? HOME_ROUTE[user.role] : "/login"} replace />;
}

export default function App() {
  return (
    <AuthProvider>
      <HashRouter>
        <Routes>
          {/* public */}
          <Route path="/login" element={<RedirectIfSignedIn><RoleSelectPage /></RedirectIfSignedIn>} />
          <Route path="/login/operator" element={<RedirectIfSignedIn><LoginPage role="OPERATOR" /></RedirectIfSignedIn>} />
          <Route path="/login/authority" element={<RedirectIfSignedIn><LoginPage role="AUTHORITY" /></RedirectIfSignedIn>} />

          {/* shared analysis surfaces — both roles review the same geometry */}
          <Route path="/overview" element={<ProtectedRoute><AppShell><OverviewPage /></AppShell></ProtectedRoute>} />
          <Route path="/satellites" element={<ProtectedRoute><AppShell><SatellitesPage /></AppShell></ProtectedRoute>} />
          <Route path="/conjunctions" element={<ProtectedRoute><AppShell><ConjunctionsPage /></AppShell></ProtectedRoute>} />
          <Route path="/space" element={<ProtectedRoute><AppShell><SpacePage /></AppShell></ProtectedRoute>} />
          <Route path="/mission-continuity" element={<ProtectedRoute><AppShell><MissionContinuityPage /></AppShell></ProtectedRoute>} />
          <Route path="/proposals" element={<ProtectedRoute><AppShell><ProposalsPage /></AppShell></ProtectedRoute>} />

          {/* operator-only: entering and simulating maneuver parameters */}
          <Route
            path="/maneuver-lab"
            element={
              <ProtectedRoute allow={["OPERATOR"]}>
                <AppShell><ManeuverLabPage /></AppShell>
              </ProtectedRoute>
            }
          />

          <Route path="/" element={<RootRedirect />} />
          <Route path="*" element={<RootRedirect />} />
        </Routes>
      </HashRouter>
    </AuthProvider>
  );
}
