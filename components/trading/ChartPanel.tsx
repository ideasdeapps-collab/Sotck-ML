'use client';

import { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries, LineSeries } from 'lightweight-charts';
import { useTradingStore } from '@/lib/trading/useTradingStore';

export default function ChartPanel() {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const { ticker, timeframe } = useTradingStore();

  useEffect(() => {
    if (!chartRef.current) return;

    const chart = createChart(chartRef.current, {
      height: 520,
      layout: { background: { color: '#0b0f14' } }
    });

    const candles = chart.addSeries(CandlestickSeries);
    candles.setData([
      { time: '2026-08-19', open: 178, high: 181, low: 176, close: 180 },
      { time: '2026-08-20', open: 180, high: 184, low: 179, close: 183 }
    ]);

    const ema = chart.addSeries(LineSeries);
    ema.setData([
      { time: '2026-08-19', value: 179 },
      { time: '2026-08-20', value: 181 }
    ]);

    chart.timeScale().fitContent();
    return () => chart.remove();
  }, [ticker, timeframe]);

  return (
    <section className="chart-panel">
      <header>
        <h3>{ticker} · {timeframe}</h3>
        <p>☑ EMA20 ☑ EMA50 ☑ VWAP ☑ Bollinger</p>
        <p>AI BUY ▲ SELL ▼</p>
      </header>
      <div ref={chartRef} />
    </section>
  );
}
