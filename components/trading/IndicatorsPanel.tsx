"use client";

import { useTradingStore } from "@/lib/trading/tradingStore";
import { calculateIndicators } from "@/lib/trading/indicators";

function format(value?: number) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "—";
}

export default function IndicatorsPanel() {
  const { candles, ticker } = useTradingStore();

  if (!candles || candles.length === 0) {
    return (
      <section>
        <h3>Indicators</h3>
        <p>Loading {ticker} series…</p>
      </section>
    );
  }

  const indicators = calculateIndicators(candles);
  const last = candles[candles.length - 1];
  const previous = candles[candles.length - 2] || last;
  const change = previous.close ? ((last.close - previous.close) / previous.close) * 100 : 0;

  return (
    <section>
      <h3>Indicators · {ticker}</h3>
      <p>Last: {format(last.close)} ({change >= 0 ? "+" : ""}{change.toFixed(2)}%)</p>
      <p>EMA20: {format(indicators.ema20.at(-1))}</p>
      <p>EMA50: {format(indicators.ema50.at(-1))}</p>
      <p>VWAP: {format(indicators.vwap.at(-1))}</p>
      <p>Bollinger: {format(indicators.bollinger.lower.at(-1))} / {format(indicators.bollinger.upper.at(-1))}</p>
      <p>Volume: {last.volume?.toLocaleString("en-US") ?? "—"}</p>
    </section>
  );
}
