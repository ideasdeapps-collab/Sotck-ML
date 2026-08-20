'use client';

import { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries, LineSeries } from 'lightweight-charts';

export default function ChartPanel() {
  const chartRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!chartRef.current) return;

    const chart = createChart(chartRef.current, {
      layout: {
        background: { color: '#0b0f14' },
        textColor: '#9ca3af',
      },
      grid: {
        vertLines: { color: '#18202b' },
        horzLines: { color: '#18202b' },
      },
      width: chartRef.current.clientWidth,
      height: 520,
    });

    const candles = chart.addSeries(CandlestickSeries);
    candles.setData([
      { time: '2026-08-19', open: 178, high: 181, low: 176, close: 180 },
      { time: '2026-08-20', open: 180, high: 184, low: 179, close: 183 },
      { time: '2026-08-21', open: 183, high: 186, low: 181, close: 185 },
    ]);

    const ema = chart.addSeries(LineSeries, { lineWidth: 2 });
    ema.setData([
      { time: '2026-08-19', value: 179 },
      { time: '2026-08-20', value: 181 },
      { time: '2026-08-21', value: 183 },
    ]);

    chart.timeScale().fitContent();

    return () => chart.remove();
  }, []);

  return (
    <section className="chart-panel">
      <header>
        <h3>TradingView Live Terminal</h3>
        <span>EMA20 · VWAP · Bollinger · AI BUY/SELL Signals</span>
      </header>
      <div ref={chartRef} />
    </section>
  );
}
