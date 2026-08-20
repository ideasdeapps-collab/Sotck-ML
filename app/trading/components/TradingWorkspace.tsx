"use client";

import { useState } from "react";
import AIRecommendation from "./AIRecommendation";
import LiveChart from "./LiveChart";
import IndicatorPanel from "./IndicatorPanel";
import MetricsPanel from "./MetricsPanel";
import TradeHistory from "./TradeHistory";
import StrategyPanel from "./StrategyPanel";
import PaperTradingPanel from "./PaperTradingPanel";

export default function TradingWorkspace() {
  const [ticker, setTicker] = useState("NVDA");
  const [status, setStatus] = useState("Ready");
  const [simulation, setSimulation] = useState<any>(null);
  const [marketData, setMarketData] = useState<any>(null);

  async function loadMarketData() {
    const response = await fetch("/api/market-data", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker }),
    });

    const data = await response.json();
    setMarketData(data);
    return data;
  }

  async function runSimulation() {
    setStatus("Running AI simulation...");

    try {
      await loadMarketData();

      const response = await fetch("/api/simulate-trading-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker }),
      });

      const result = await response.json();
      setSimulation(result);
      setStatus("Simulation completed");
    } catch {
      setStatus("Waiting for AI engine connection");
    }
  }

  const signals = simulation?.signals || simulation?.signal ? [simulation.signal] : [];

  return (
    <main className="grid grid-cols-12 gap-3 p-4 bg-zinc-950 text-white min-h-screen">
      <aside className="col-span-12 lg:col-span-2">
        <StrategyPanel />
      </aside>

      <section className="col-span-12 lg:col-span-7 space-y-3">
        <div className="border rounded p-3 bg-zinc-900 flex gap-3">
          <input
            className="border rounded p-2 bg-black w-32"
            value={ticker}
            onChange={(e) => setTicker(e.target.value.toUpperCase())}
          />
          <button className="border rounded px-4" onClick={runSimulation}>
            Run AI Trade
          </button>
          <span className="text-sm">{status}</span>
        </div>

        <LiveChart candles={marketData?.candles} signals={signals} />

        {simulation && <AIRecommendation data={simulation} />}
      </section>

      <aside className="col-span-12 lg:col-span-3 space-y-3">
        <PaperTradingPanel />
        <IndicatorPanel
          ema20={simulation?.features?.ema20}
          ema50={simulation?.features?.ema50}
          rsi={simulation?.features?.rsi}
          volumeRatio={simulation?.features?.volumeRatio}
        />
      </aside>

      {simulation && (
        <>
          <section className="col-span-12 lg:col-span-4">
            <MetricsPanel metrics={simulation.metrics} />
          </section>
          <section className="col-span-12 lg:col-span-8">
            <TradeHistory trades={simulation.trades} />
          </section>
        </>
      )}
    </main>
  );
}
