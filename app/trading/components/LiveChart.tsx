"use client";

import { useEffect, useRef, useState } from "react";
import { createChart, CandlestickSeries, LineSeries } from "lightweight-charts";

type Candle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  ema20?: number;
  ema50?: number;
  vwap?: number;
  rsi?: number;
  macd?: number;
};

type Signal = {
  action: "BUY" | "SELL";
  time: string;
  price: number;
  confidence?: number;
};

const timeframes = ["1m", "5m", "15m", "1H", "1D"];

export default function LiveChart({
  candles = [],
  signals = [],
}: {
  candles?: Candle[];
  signals?: Signal[];
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [timeframe, setTimeframe] = useState("1m");

  useEffect(() => {
    if (!chartRef.current || candles.length === 0) return;

    chartRef.current.innerHTML = "";

    const chart = createChart(chartRef.current, {
      layout: {
        background: { color: "#09090b" },
        textColor: "#d4d4d8",
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      height: 460,
      rightPriceScale: {
        borderVisible: false,
      },
    });

    const candleSeries = chart.addSeries(CandlestickSeries);
    candleSeries.setData(
      candles.map((c) => ({
        time: c.time as any,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
      }))
    );

    const addIndicator = (key: "ema20" | "ema50" | "vwap") => {
      const series = chart.addSeries(LineSeries);
      series.setData(
        candles
          .filter((c) => c[key] !== undefined)
          .map((c) => ({ time: c.time as any, value: c[key]! }))
      );
    };

    addIndicator("ema20");
    addIndicator("ema50");
    addIndicator("vwap");

    chart.timeScale().fitContent();

    return () => chart.remove();
  }, [candles, timeframe]);

  return (
    <div className="border rounded-xl p-4 bg-zinc-950 space-y-3">
      <div className="flex justify-between items-center">
        <h3 className="font-semibold">TradingView Pro Chart</h3>
        <div className="flex gap-2 text-xs">
          {timeframes.map((tf) => (
            <button
              key={tf}
              onClick={() => setTimeframe(tf)}
              className="border rounded px-2 py-1"
            >
              {tf}
            </button>
          ))}
        </div>
      </div>

      <div className="text-xs text-zinc-400">
        Candles | EMA20 | EMA50 | VWAP | RSI | MACD | AI Signals
      </div>

      {candles.length === 0 ? (
        <div className="h-96 flex items-center justify-center text-zinc-400">
          Waiting for market candles
        </div>
      ) : (
        <div ref={chartRef} />
      )}

      <div className="flex gap-2 text-xs flex-wrap">
        {signals.map((s, i) => (
          <span key={i} className="border rounded px-2 py-1">
            {s.action} {s.price} {s.confidence ? `${s.confidence}%` : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
