"use client";

import { useEffect, useRef } from "react";
import { createChart, CandlestickSeries, LineSeries } from "lightweight-charts";

type Candle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  ema20?: number;
  ema50?: number;
  vwap?: number;
};

type Signal = {
  action: "BUY" | "SELL";
  time: string;
  price: number;
};

export default function LiveChart({
  candles = [],
  signals = [],
}: {
  candles?: Candle[];
  signals?: Signal[];
}) {
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!chartRef.current || candles.length === 0) return;

    const chart = createChart(chartRef.current, {
      layout: {
        background: { color: "#09090b" },
        textColor: "#d4d4d8",
      },
      grid: {
        vertLines: { visible: false },
        horzLines: { visible: false },
      },
      height: 420,
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

    const ema20Series = chart.addSeries(LineSeries);
    ema20Series.setData(
      candles.filter((c) => c.ema20).map((c) => ({ time: c.time as any, value: c.ema20! }))
    );

    const ema50Series = chart.addSeries(LineSeries);
    ema50Series.setData(
      candles.filter((c) => c.ema50).map((c) => ({ time: c.time as any, value: c.ema50! }))
    );

    const vwapSeries = chart.addSeries(LineSeries);
    vwapSeries.setData(
      candles.filter((c) => c.vwap).map((c) => ({ time: c.time as any, value: c.vwap! }))
    );

    chart.timeScale().fitContent();

    return () => chart.remove();
  }, [candles]);

  return (
    <div className="border rounded-xl p-4 bg-zinc-950 space-y-3">
      <div className="flex justify-between text-sm">
        <h3 className="font-semibold">TradingView Chart</h3>
        <span>1m | EMA | VWAP | AI Signals</span>
      </div>

      {candles.length === 0 ? (
        <div className="h-96 flex items-center justify-center text-zinc-400">
          Waiting for market candles
        </div>
      ) : (
        <div ref={chartRef} />
      )}

      <div className="flex gap-2 text-xs">
        {signals.map((s, i) => (
          <span key={i} className="border rounded px-2 py-1">
            {s.action} {s.price}
          </span>
        ))}
      </div>
    </div>
  );
}
