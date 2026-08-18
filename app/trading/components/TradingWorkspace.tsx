"use client";

import { useState } from "react";

export default function TradingWorkspace() {
  const [ticker, setTicker] = useState("NVDA");
  const [status, setStatus] = useState("Ready");

  async function runSimulation() {
    setStatus("Running AI simulation...");

    try {
      const response = await fetch("/api/simulate-trading-ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker }),
      });

      if (!response.ok) {
        throw new Error("Simulation endpoint unavailable");
      }

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

      <section className="lg:col-span-2 border rounded p-4">
        <h2 className="font-semibold">Chart / Indicators</h2>
        <div className="mt-4 h-48 flex items-center justify-center">
          Market Chart Engine
        </div>
      </section>

      <section className="border rounded p-4">
        <h2 className="font-semibold">AI Strategy Agent</h2>
        <button
          className="border rounded px-3 py-2 mt-3"
          onClick={runSimulation}
        >
          Simulate AI Trade
        </button>
        <p className="mt-3 text-sm">{status}</p>
      </section>

      <section className="lg:col-span-4 border rounded p-4">
        Trade Log / Performance Metrics
      </section>
    </main>
  );
}
