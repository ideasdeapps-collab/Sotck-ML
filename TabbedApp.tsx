"use client";

import { useState } from "react";
import StockForecastChart from "./StockForecastChart";
import IntradayChart from "./IntradayChart";
import SignalsTab from "./SignalsTab";
import Dashboard from "./Dashboard";
import LiveTradingTab from "./LiveTradingTab";

const TABS = [
  { id: "forecast", label: "📈 Predicción", node: <StockForecastChart /> },
  { id: "intraday", label: "📉 Intradía", node: <IntradayChart /> },
  { id: "signals", label: "🔔 Señales combinadas", node: <SignalsTab /> },
  { id: "live", label: "🤖 AI Live Trading", node: <LiveTradingTab /> },
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
              padding: "10px 18px",
              border: "none",
              cursor: "pointer",
              background: "transparent",
              fontWeight: active === t.id ? 700 : 400,
              borderBottom: active === t.id ? "2px solid #111" : "2px solid transparent",
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
