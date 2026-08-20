"use client";

import { useState } from "react";
import StockForecastChart from "./StockForecastChart";
import IntradayChart from "./IntradayChart";
import SignalsTab from "./SignalsTab";
import TechnicalTab from "./TechnicalTab";
import PsychologyTab from "./PsychologyTab";
import ModelValidationTab from "./ModelValidationTab";
import BacktestChart from "./BacktestChart";
import Dashboard from "./Dashboard";
import IntradaySessionTab from "./IntradaySessionTab";
import LiveTradingTab from "./LiveTradingTab";

function TradingLabLink() {
  return (
    <div style={{ padding: 24, border: "1px solid #eee", borderRadius: 12 }}>
      <p style={{ margin: "0 0 12px" }}>
        Trading Lab tiene su propio terminal a pantalla completa.
      </p>
      <a
        href="/trading"
        style={{
          display: "inline-block",
          padding: "10px 16px",
          borderRadius: 8,
          background: "#05070a",
          color: "#22c55e",
          fontWeight: 700,
          textDecoration: "none",
        }}
      >
        Abrir Trading Lab →
      </a>
    </div>
  );
}

const TABS = [
  { id: "forecast", label: "📈 Predicción", node: <StockForecastChart /> },
  { id: "intraday", label: "📉 Intradía", node: <IntradayChart /> },
  { id: "signals", label: "🔔 Señales", node: <SignalsTab /> },
  { id: "technical", label: "🌊 Técnico (Elliott)", node: <TechnicalTab /> },
  { id: "psychology", label: "🧠 Psicología (IPM)", node: <PsychologyTab /> },
  { id: "validation", label: "📌 Validación", node: <ModelValidationTab /> },
  { id: "intraday-ml", label: "🕐 Sesión ML", node: <IntradaySessionTab /> },
  { id: "backtest", label: "🎯 Backtest", node: <BacktestChart /> },
  { id: "live", label: "🤖 AI Live Trading", node: <LiveTradingTab /> },
  { id: "trading-lab", label: "🧪 Trading Lab", node: <TradingLabLink /> },
  { id: "dashboard", label: "📊 Panel", node: <Dashboard /> },
];

export default function TabbedApp() {
  const [active, setActive] = useState("forecast");

  return (
    <div style={{ maxWidth: 1040, margin: "0 auto", padding: 16, fontFamily: "system-ui" }}>
      <div style={{ display: "flex", gap: 4, flexWrap: "wrap", borderBottom: "2px solid #eee", marginBottom: 20 }}>
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setActive(t.id)}>{t.label}</button>
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
