"use client";

import { useState } from "react";
import { useTradingStore } from "@/lib/trading/tradingStore";

const WATCHLIST = ["NVDA", "AMD", "TSLA", "AAPL", "MSFT"];
const MODES = ["Live", "Replay", "Simulation"];

export default function TradingSidebar() {
  const { ticker, setTicker, mode, setMode, timeframe, setSignal, signal, setSession, session, capital } =
    useTradingStore();
  const [draft, setDraft] = useState(ticker);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function startAISession() {
    setLoading(true);
    setError("");
    setSession(true);

    try {
      const response = await fetch("/api/ai/realtime-monitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, timeframe }),
      });

      const data = await response.json();

      if (!response.ok) throw new Error(data?.error || "AI engine unavailable");

      setSignal(data);
    } catch (err: any) {
      setError(err?.message || "AI engine unavailable");
      setSession(false);
    } finally {
      setLoading(false);
    }
  }

  return (
    <aside className="trading-sidebar">
      <h2>Trading Lab Pro</h2>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (draft.trim()) setTicker(draft.trim().toUpperCase());
        }}
      >
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value.toUpperCase())}
          placeholder="Search ticker"
          aria-label="Ticker"
        />
      </form>

      <h3>Watchlist</h3>
      <div className="trading-sidebar__watchlist">
        {WATCHLIST.map((symbol) => (
          <button
            key={symbol}
            type="button"
            className={symbol === ticker ? "is-active" : ""}
            onClick={() => {
              setTicker(symbol);
              setDraft(symbol);
            }}
          >
            {symbol}
          </button>
        ))}
      </div>

      <h3>Market Mode</h3>
      <div className="trading-sidebar__modes">
        {MODES.map((option) => (
          <label key={option}>
            <input type="radio" name="market-mode" checked={mode === option} onChange={() => setMode(option)} />
            {option}
          </label>
        ))}
      </div>

      <h3>Capital</h3>
      <p>${capital.toLocaleString("en-US")}</p>

      <button type="button" className="trading-sidebar__cta" onClick={startAISession} disabled={loading}>
        {loading ? "ANALYZING…" : session ? "REFRESH AI SESSION" : "START AI SESSION"}
      </button>

      {error && <p className="trading-sidebar__error">{error}</p>}

      {signal && (
        <section className="trading-sidebar__signal">
          <h3 data-signal={signal.signal}>{signal.signal}</h3>
          <p>Confidence: {signal.confidence}%</p>
          <p>{signal.strategy}</p>
          {signal.entry ? (
            <p>
              Entry {signal.entry} · Stop {signal.stop} · Target {signal.target}
            </p>
          ) : null}
        </section>
      )}
    </aside>
  );
}
