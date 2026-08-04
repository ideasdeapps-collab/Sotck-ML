"use client";

/**
 * TabbedApp.tsx — Contenedor de pestañas
 * ======================================
 *   1) Predicción            -> StockForecastChart (curvas + simulador)
 *   2) Intradía               -> IntradayChart
 *   3) Señales                -> SignalsTab
 *   4) Técnico (Elliott)      -> TechnicalTab
 *   5) Psicología (IPM)       -> PsychologyTab
 *   6) Validación de modelos  -> ModelValidationTab   ← NUEVA (snapshots vs real)
 *   7) Backtest               -> BacktestChart
 *   8) Panel                  -> Dashboard
 */

import { useState } from "react";
import StockForecastChart from "./StockForecastChart";
import IntradayChart from "./IntradayChart";
import SignalsTab from "./SignalsTab";
import TechnicalTab from "./TechnicalTab";
import PsychologyTab from "./PsychologyTab";
import ModelValidationTab from "./ModelValidationTab";
import BacktestChart from "./BacktestChart";
import Dashboard from "./Dashboard";

const TABS = [
  { id: "forecast", label: "📈 Predicción", node: <StockForecastChart /> },
  { id: "intraday", label: "📉 Intradía", node: <IntradayChart /> },
  { id: "signals", label: "🔔 Señales", node: <SignalsTab /> },
  { id: "technical", label: "🌊 Técnico (Elliott)", node: <TechnicalTab /> },
  { id: "psychology", label: "🧠 Psicología (IPM)", node: <PsychologyTab /> },
  { id: "validation", label: "📌 Validación de modelos", node: <ModelValidationTab /> },
  { id: "backtest", label: "🎯 Backtest", node: <BacktestChart /> },
  { id: "dashboard", label: "📊 Panel", node: <Dashboard /> },
];

export default function TabbedApp() {
  const [active, setActive] = useState("forecast");

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: 16, fontFamily: "system-ui" }}>
      <div style={{ display: "flex", gap: 4, borderBottom: "2px solid #eee",
                    marginBottom: 20, flexWrap: "wrap" }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setActive(t.id)}
            style={{
              padding: "10px 16px", border: "none", cursor: "pointer",
              background: "transparent", fontSize: 14,
              fontWeight: active === t.id ? 700 : 400,
              color: active === t.id ? "#111" : "#888",
              borderBottom: active === t.id ? "2px solid #111" : "2px solid transparent",
              marginBottom: -2,
            }}>
            {t.label}
          </button>
        ))}
      </div>
      {TABS.map((t) => (
        <div key={t.id} style={{ display: active === t.id ? "block" : "none" }}>{t.node}</div>
      ))}
    </div>
  );
}
