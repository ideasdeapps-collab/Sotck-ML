"use client";

import { useState } from "react";
import { useTradingStore } from "@/lib/trading/tradingStore";
import { fetchJson } from "@/lib/trading/fetchJson";
import { setCapital as setEngineCapital } from "@/lib/trading/paperEngine";

const MODES = ["Live", "Replay", "Simulation"];

export default function TradingSidebar() {
  const {
    ticker,
    setTicker,
    mode,
    setMode,
    timeframe,
    setSignal,
    signal,
    setSession,
    session,
    capital,
    setCapital,
    watchlist,
    addToWatchlist,
    removeFromWatchlist,
  } = useTradingStore();

  const [draft, setDraft] = useState(ticker);
  const [capitalDraft, setCapitalDraft] = useState(String(capital));
  const [capitalNote, setCapitalNote] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  function submitTicker(event: React.FormEvent) {
    event.preventDefault();
    const symbol = draft.trim().toUpperCase();
    if (!symbol) return;
    addToWatchlist(symbol);
    setTicker(symbol);
  }

  function commitCapital() {
    const amount = Number(capitalDraft.replace(/[^0-9.]/g, ""));

    if (!Number.isFinite(amount) || amount <= 0) {
      setCapitalNote("Enter an amount greater than 0");
      setCapitalDraft(String(capital));
      return;
    }

    const applied = setEngineCapital(amount);

    if (applied === null) {
      setCapitalNote("Close open positions before changing capital");
      setCapitalDraft(String(capital));
      return;
    }

    setCapital(amount);
    setCapitalNote("");
  }

  async function startAISession() {
    setLoading(true);
    setError("");
    setSession(true);

    try {
      const data = await fetchJson("/api/ai/realtime-monitor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ticker, timeframe }),
      });

      if (data?.error) throw new Error(data.error);
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

      <form onSubmit={submitTicker} className="trading-sidebar__search">
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value.toUpperCase())}
          placeholder="Add ticker"
          aria-label="Ticker"
        />
        <button type="submit">+</button>
      </form>

      <h3>Watchlist</h3>
      <div className="trading-sidebar__watchlist">
        {watchlist.map((symbol) => (
          <span key={symbol} className={symbol === ticker ? "is-active" : ""}>
            <button
              type="button"
              onClick={() => {
                setTicker(symbol);
                setDraft(symbol);
              }}
            >
              {symbol}
            </button>
            <button
              type="button"
              className="trading-sidebar__remove"
              aria-label={`Remove ${symbol}`}
              onClick={() => removeFromWatchlist(symbol)}
            >
              ×
            </button>
          </span>
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
      <div className="trading-sidebar__capital">
        <span>$</span>
        <input
          value={capitalDraft}
          onChange={(event) => setCapitalDraft(event.target.value)}
          onBlur={commitCapital}
          onKeyDown={(event) => {
            if (event.key === "Enter") (event.target as HTMLInputElement).blur();
          }}
          inputMode="decimal"
          aria-label="Starting capital"
        />
      </div>
      {capitalNote && <p className="trading-sidebar__note">{capitalNote}</p>}

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
