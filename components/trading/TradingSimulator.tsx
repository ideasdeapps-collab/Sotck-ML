"use client";

import { useState } from "react";
import { openPosition, closePosition, usePortfolio } from "@/lib/trading/paperEngine";
import { useTradingStore } from "@/lib/trading/tradingStore";

export default function TradingSimulator() {
  const { ticker, signal, capital } = useTradingStore();
  const portfolio = usePortfolio();

  // Reflect capital edits made in the sidebar while no position is open.
  const balance = portfolio.positions.length === 0 ? capital : portfolio.balance;
  const [shares, setShares] = useState(100);
  const [message, setMessage] = useState("");

  const entry = Number(signal?.entry) || 0;
  // Scoped to `manual`: the copilot manages its own positions and SELL here
  // must not close one of them out from under it.
  const open = portfolio.positions.find(
    (position) => position.ticker === ticker && position.owner === "manual"
  );

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
  }

  function sell() {
    if (!entry) {
      setMessage("Run an AI session first to get a live price");
      return;
    }

    const pnl = open ? closePosition(ticker, entry, open.id) : null;
    setMessage(pnl === null ? `No open position on ${ticker}` : `Closed ${ticker} · PnL ${pnl.toFixed(2)}`);
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
      <p>Balance ${balance.toFixed(2)}</p>
      <p>
        Position: {open ? `${open.shares} @ ${open.entry}` : "None"}
      </p>
      {message && <p className="simulator__message">{message}</p>}
    </section>
  );
}
