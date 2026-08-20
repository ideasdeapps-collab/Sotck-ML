"use client";

import { useTradingStore } from "@/lib/trading/tradingStore";
import { calculateIndicators } from "@/lib/trading/indicators";

const BASE = [
  { name: "Momentum Breakout", bias: "bull" as const },
  { name: "Mean Reversion", bias: "bear" as const },
  { name: "VWAP Reclaim", bias: "vwap" as const },
];

export default function StrategiesPanel() {
  const { candles, signal } = useTradingStore();

  const scores = BASE.map((strategy) => {
    if (!candles || candles.length === 0) return { ...strategy, confidence: 0 };

    const indicators = calculateIndicators(candles);
    const last = candles[candles.length - 1];
    const ema20 = indicators.ema20.at(-1) ?? last.close;
    const ema50 = indicators.ema50.at(-1) ?? last.close;
    const vwap = indicators.vwap.at(-1) ?? last.close;

    if (strategy.bias === "bull") {
      return { ...strategy, confidence: last.close > ema20 && ema20 > ema50 ? 91 : 48 };
    }
    if (strategy.bias === "bear") {
      return { ...strategy, confidence: last.close < ema20 && ema20 < ema50 ? 84 : 45 };
    }
    return { ...strategy, confidence: last.close > vwap ? 74 : 52 };
  });

  return (
    <section>
      <h3>AI Strategies</h3>
      {scores.map((strategy) => (
        <div key={strategy.name} className="strategy-row">
          <b>{strategy.name}</b>
          <p>Confidence {strategy.confidence}%</p>
          <progress value={strategy.confidence} max={100} />
        </div>
      ))}
      {signal && <p className="strategy-row__active">Active: {signal.strategy}</p>}
    </section>
  );
}
