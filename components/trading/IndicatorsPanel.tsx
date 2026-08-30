"use client";

import { useTradingStore } from "@/lib/trading/tradingStore";
import { calculateIndicators } from "@/lib/trading/indicators";
import { calculateOpeningRange } from "@/lib/trading/dayTrading/openingRange";
import { previousDayLevels } from "@/lib/trading/dayTrading/sessions";
import type { Candle } from "@/lib/trading/marketData";

function format(value?: number | null) {
  return typeof value === "number" && Number.isFinite(value) ? value.toFixed(2) : "—";
}

export default function IndicatorsPanel() {
  const { candles, ticker, dataError } = useTradingStore();

  if (!candles || candles.length === 0) {
    return (
      <section>
        <h3>Indicators</h3>
        {dataError ? (
          <p className="panel__error">No data for {ticker} — {dataError}</p>
        ) : (
          <p>Loading {ticker} series…</p>
        )}
      </section>
    );
  }

  const series = candles as Candle[];
  const indicators = calculateIndicators(series);
  const last = series[series.length - 1];
  const previous = series[series.length - 2] || last;
  const change = previous.close ? ((last.close - previous.close) / previous.close) * 100 : 0;

  const bands = indicators.vwapBands;
  const openingRange = calculateOpeningRange(series, 15);
  const priorDay = previousDayLevels(series);

  return (
    <section>
      <h3>Indicators · {ticker}</h3>
      <p>Last: {format(last.close)} ({change >= 0 ? "+" : ""}{change.toFixed(2)}%)</p>
      <p>EMA20: {format(indicators.ema20.at(-1))}</p>
      <p>EMA50: {format(indicators.ema50.at(-1))}</p>
      <p>
        VWAP: {format(bands.vwap.at(-1))}{" "}
        <small>{bands.anchored ? "(sesión)" : "(acumulado — timeframe diario)"}</small>
      </p>
      <p>
        VWAP ±1σ: {format(bands.lower1.at(-1))} / {format(bands.upper1.at(-1))}
      </p>
      <p>Bollinger: {format(indicators.bollinger.lower.at(-1))} / {format(indicators.bollinger.upper.at(-1))}</p>
      {openingRange && (
        <p>
          Opening range {openingRange.minutes}m: {format(openingRange.low)} / {format(openingRange.high)}
          {openingRange.breakout && <b> · ruptura {openingRange.breakout.direction === "UP" ? "↑" : "↓"}</b>}
        </p>
      )}
      {priorDay && (
        <p>
          Día previo: H {format(priorDay.high)} · L {format(priorDay.low)} · C {format(priorDay.close)}
        </p>
      )}
      <p>Volume: {last.volume?.toLocaleString("en-US") ?? "—"}</p>
    </section>
  );
}
