"use client";

/**
 * TabbedApp.tsx — Contenedor de pestañas
 * ======================================
 * Une las vistas de la app en una sola página con pestañas:
 *   1) Predicción   -> StockForecastChart (histórico + XGBoost + Monte Carlo)
 *   2) Intradía     -> IntradayChart (velas + chartismo + price action)
 *   3) Señales      -> SignalsTab (sesgo diario × estructura intradía)
 *   4) Panel        -> Dashboard (tabla de los 18 tickers)
 *
 * Uso en Next.js (app router):
 *   import TabbedApp from "@/components/TabbedApp";
 *   export default function Page() { return <TabbedApp />; }
 */

import { useState } from "react";
import StockForecastChart from "./StockForecastChart";
import IntradayChart from "./IntradayChart";
import SignalsTab from "./SignalsTab";
import Dashboard from "./Dashboard";

const TABS = [
  { id: "forecast", label: "📈 Predicción", node: <StockForecastChart /> },
  { id: "intraday", label: "📉 Intradía", node: <IntradayChart /> },
  { id: "signals", label: "🔔 Señales combinadas", node: <SignalsTab /> },
  { id: "dashboard", label: "📊 Panel", node: <Dashboard /> },
];

export default function TabbedApp() {
  const [active, setActive] = useState("signals");

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: 16, fontFamily: "system-ui" }}>
      <div style={{ display: "flex", gap: 4, borderBottom: "2px solid #eee", marginBottom: 20 }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setActive(t.id)}
            style={{
              padding: "10px 18px", border: "none", cursor: "pointer",
              background: "transparent", fontSize: 14,
              fontWeight: active === t.id ? 700 : 400,
              color: active === t.id ? "#111" : "#888",
              borderBottom: active === t.id ? "2px solid #111" : "2px solid transparent",
              marginBottom: -2,
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {TABS.map((t) => (
        <div key={t.id} style={{ display: active === t.id ? "block" : "none" }}>
          {t.node}
        </div>
      ))}
    </div>
  );
}
