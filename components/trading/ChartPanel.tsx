'use client';

import { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries, LineSeries } from 'lightweight-charts';
import { useTradingStore } from '@/lib/trading/tradingStore';

export default function ChartPanel() {
  const chartRef = useRef<HTMLDivElement | null>(null);
  const { ticker, timeframe, markers, setMarkers } = useTradingStore();

  useEffect(() => {
    if (!chartRef.current) return;

    const chart = createChart(chartRef.current, {
      height: 520,
      layout: { background: { color: '#0b0f14' } }
    });

    const candleSeries = chart.addSeries(CandlestickSeries);
    const ema20Series = chart.addSeries(LineSeries);
    const ema50Series = chart.addSeries(LineSeries);
    const vwapSeries = chart.addSeries(LineSeries);
    const bollingerUpper = chart.addSeries(LineSeries);
    const bollingerLower = chart.addSeries(LineSeries);

    async function loadCandles() {
      const response = await fetch(`/api/market/candles?ticker=${ticker}&timeframe=${timeframe}`);
      const data = await response.json();

      const candles = data.candles || data;
      candleSeries.setData(candles);

      if (data.indicators) {
        ema20Series.setData(data.indicators.ema20 || []);
        ema50Series.setData(data.indicators.ema50 || []);
        vwapSeries.setData(data.indicators.vwap || []);
        bollingerUpper.setData(data.indicators.bollingerUpper || []);
        bollingerLower.setData(data.indicators.bollingerLower || []);
      }

      if (markers.length) {
        candleSeries.setMarkers(markers);
      }
    }

    loadCandles();
    chart.timeScale().fitContent();

    return () => chart.remove();
  }, [ticker, timeframe, markers]);

  return (
    <section className="chart-panel">
      <header>
        <h3>{ticker} · {timeframe}</h3>
        <p>EMA20 · EMA50 · VWAP · Bollinger Bands</p>
        <p>AI Signals enabled</p>
      </header>
      <div ref={chartRef} />
    </section>
  );
}
