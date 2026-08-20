"use client";

import { useState } from "react";
import { openPosition, closePosition, getPortfolio, type Portfolio } from "@/lib/trading/paperEngine";
import { useTradingStore } from "@/lib/trading/tradingStore";

export default function TradingSimulator() {
  const { ticker, signal } = useTradingStore();
  const [portfolio, setPortfolio] = useState<Portfolio>(() => getPortfolio());
  const [shares, setShares] = useState(100);
  const [message, setMessage] = useState("");

  const entry = Number(signal?.entry) || 0;
  const open = portfolio.positions.find((position) => position.ticker === ticker);

  function buy() {
    if (!entry) {
      setMessage("Run an AI session first to get a live price");
      return;
    }

    const result = openPosition({
      ticker,
      shares,
      entry,
      stop: +(entry * 0.98).toFixed(2),
      target: +(entry * 1.04).toFixed(2),
    });

    setMessage(result ? `Bought ${shares} ${ticker} @ ${entry}` : "Insufficient balance");
    setPortfolio(getPortfolio());
  }

  function sell() {
    if (!entry) {
      setMessage("Run an AI session first to get a live price");
      return;
    }

    const pnl = closePosition(ticker, entry);
    setMessage(pnl === null ? `No open position on ${ticker}` : `Closed ${ticker} · PnL ${pnl.toFixed(2)}`);
    setPortfolio(getPortfolio());
  }

  return (
    <section>
      <h3>Paper Trading</h3>
      <p>
        {ticker} · {entry ? `price ${entry}` : "waiting for AI signal"}
      </p>
      <label className="simulator__field">
        Shares
        <input
          type="number"
          min={1}
          value={shares}
          onChange={(event) => setShares(Math.max(1, Number(event.target.value) || 1))}
        />
      </label>
      <div className="simulator__actions">
        <button type="button" onClick={buy}>
          BUY
        </button>
        <button type="button" onClick={sell} disabled={!open}>
          SELL
        </button>
      </div>
      <p>Balance ${portfolio.balance.toFixed(2)}</p>
      <p>
        Position: {open ? `${open.shares} @ ${open.entry}` : "None"}
      </p>
      {message && <p className="simulator__message">{message}</p>}
    </section>
  );
}
