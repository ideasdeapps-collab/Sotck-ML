"use client";

import { useEffect, useState } from "react";

type Portfolio = {
  cash: number;
  equity: number;
  positions: { ticker: string; quantity: number; entry: number }[];
  trades: any[];
};

export default function PerformancePanel() {
  const [portfolio, setPortfolio] = useState<Portfolio | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/trading/portfolio", { cache: "no-store" })
      .then((response) => response.json())
      .then(setPortfolio)
      .catch((err) => setError(err?.message || "Portfolio unavailable"));
  }, []);

  if (error) {
    return (
      <section>
        <h3>Paper Account</h3>
        <p>{error}</p>
      </section>
    );
  }

  const equity = portfolio?.equity ?? 100000;
  const returnPct = ((equity - 100000) / 100000) * 100;

  return (
    <section>
      <h3>Paper Account</h3>
      <p>Equity ${equity.toLocaleString("en-US", { maximumFractionDigits: 2 })}</p>
      <p>Cash ${(portfolio?.cash ?? 100000).toLocaleString("en-US", { maximumFractionDigits: 2 })}</p>
      <p>Total Return {returnPct.toFixed(2)}%</p>
      <p>Open positions {portfolio?.positions?.length ?? 0}</p>
      <p>Trades {portfolio?.trades?.length ?? 0}</p>
    </section>
  );
}
