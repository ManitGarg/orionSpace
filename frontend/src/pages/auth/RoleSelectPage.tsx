import React from "react";
import { useNavigate } from "react-router-dom";

export function RoleSelectPage() {
  const navigate = useNavigate();
  return (
    <div className="auth-screen">
      <div className="auth-card">
        <div className="auth-brand">
          <span className="dot" />
          ORION
        </div>
        <div className="auth-subtitle">Secure Mission Operations</div>

        <div className="auth-section-label">Choose Access Role</div>

        <button className="auth-role-btn" onClick={() => navigate("/login/operator")}>
          <span className="role-title">OPERATOR ACCESS</span>
          <span className="role-desc">
            Analyse conjunctions, run maneuver simulations, and submit proposals for review.
          </span>
        </button>

        <button className="auth-role-btn" onClick={() => navigate("/login/authority")}>
          <span className="role-title">AUTHORITY ACCESS</span>
          <span className="role-desc">
            Review submitted proposals, risk calculations and mission impact, then approve or reject.
          </span>
        </button>

        <div className="auth-footnote">
          Prototype demonstration. ORION does not command spacecraft, execute burns, or grant official
          authority approval.
        </div>
      </div>
    </div>
  );
}
