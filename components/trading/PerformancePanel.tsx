"use client";

import { useTradingStore } from "@/lib/trading/tradingStore";
import { getPortfolio } from "@/lib/trading/paperEngine";

function money(value: number) {
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export default function PerformancePanel() {
  // portfolioVersion is the re-render trigger: the paper engine holds the
  // positions, the store only tracks that they changed.
  const { capital, portfolioVersion, signal } = useTradingStore();
  const portfolio = getPortfolio();
  void portfolioVersion;

  const balance = portfolio.positions.length === 0 && portfolio.history.length === 0 ? capital : portfolio.balance;
  const mark = Number(signal?.entry) || 0;

  const openValue = portfolio.positions.reduce(
    (total, position) => total + position.shares * (mark || position.entry),
    0
  );

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
