"use client";

import { useState } from "react";
import AIRecommendation from "./AIRecommendation";
import LiveChart from "./LiveChart";
import IndicatorPanel from "./IndicatorPanel";

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

  return (
    <main className="grid grid-cols-1 lg:grid-cols-4 gap-4 p-4">
      <section className="border rounded p-4">
        <h2 className="font-semibold">Watchlist</h2>
        <input
          className="border rounded p-2 mt-3 w-full"
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
        />
      </section>

      <section className="lg:col-span-2">
        <LiveChart candles={marketData?.candles} />
      </section>

      <section>
        <IndicatorPanel
          ema20={simulation?.features?.ema20}
          ema50={simulation?.features?.ema50}
          rsi={simulation?.features?.rsi}
          volumeRatio={simulation?.features?.volumeRatio}
        />
      </section>

      <section className="border rounded p-4">
        <h2 className="font-semibold">AI Strategy Agent</h2>
        <button className="border rounded px-3 py-2 mt-3" onClick={runSimulation}>
          Simulate AI Trade
        </button>
        <p className="mt-3 text-sm">{status}</p>
      </section>

      {simulation && <AIRecommendation data={simulation} />}
    </main>
  );
}
