"use client";

import { useTradingStore } from "@/lib/trading/tradingStore";
import { calculatePnL, usePortfolio } from "@/lib/trading/paperEngine";

function money(value: number) {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function PerformancePanel() {
  const { capital, ticker, candles } = useTradingStore();
  const portfolio = usePortfolio();

  const balance = portfolio.positions.length === 0 && portfolio.history.length === 0 ? capital : portfolio.balance;
  // Only the ticker on screen has a live price; anything else is marked at its
  // own entry, which is the honest "unknown" rather than a stale quote.
  const mark = Number(candles[candles.length - 1]?.close) || 0;

  // The notional was deducted when the position opened, so it comes back into
  // equity alongside the open result — and that result is direction aware, or a
  // short would show a loss exactly when it is winning.
  const openValue = portfolio.positions.reduce((total, position) => {
    const price = position.ticker === ticker && mark ? mark : position.entry;
    return total + position.shares * position.entry + calculatePnL(position, price);
  }, 0);

  const equity = balance + openValue;
  const realized = portfolio.history.reduce((total, trade) => total + trade.pnl, 0);
  const wins = portfolio.history.filter((trade) => trade.pnl > 0).length;
  const winRate = portfolio.history.length ? (wins / portfolio.history.length) * 100 : 0;
  const returnPct = capital ? ((equity - capital) / capital) * 100 : 0;

  return (
    <section>
      <h3>Paper Account</h3>
      <p>Equity ${money(equity)}</p>
      <p>Cash ${money(balance)}</p>
      <p>Total Return {returnPct.toFixed(2)}%</p>
      <p>Realized PnL ${money(realized)}</p>
      <p>Win Rate {winRate.toFixed(0)}% ({portfolio.history.length} closed)</p>
      <p>Open positions {portfolio.positions.length}</p>
    </section>
  );
}
