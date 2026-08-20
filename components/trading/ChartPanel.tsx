'use client';

import { useEffect, useRef, useState } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  createSeriesMarkers,
  type IChartApi,
} from 'lightweight-charts';
import { useTradingStore } from '@/lib/trading/tradingStore';
import { connectPolygonStream } from '@/lib/trading/polygonStream';
import { generateAISignal, signalToMarker } from '@/lib/trading/aiSignalEngine';
import { calculateIndicators } from '@/lib/trading/indicators';
import type { Candle } from '@/lib/trading/marketData';

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '1d'];

export default function ChartPanel() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const candlesRef = useRef<Candle[]>([]);
  const { ticker, timeframe, setTimeframe, setMarkers, setCandles, setLive } = useTradingStore();
  const [source, setSource] = useState<string>('');
  const [isDemo, setIsDemo] = useState(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let chart: IChartApi | null = null;
    let disconnect: (() => void) | undefined;
    let disposed = false;

    chart = createChart(container, {
      autoSize: true,
      height: 520,
      layout: { background: { color: '#0b0f14' }, textColor: '#9ca3af' },
      grid: {
        vertLines: { color: 'rgba(148,163,184,0.08)' },
        horzLines: { color: 'rgba(148,163,184,0.08)' },
      },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true },
    });

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      wickUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      borderVisible: false,
    });
    const ema20Series = chart.addSeries(LineSeries, { color: '#38bdf8', lineWidth: 1 });
    const ema50Series = chart.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 1 });
    const markerApi = createSeriesMarkers(candleSeries, []);

    function paintIndicators(candles: Candle[]) {
      if (candles.length === 0) return;
      const indicators = calculateIndicators(candles);
      ema20Series.setData(candles.map((c, i) => ({ time: c.time as any, value: indicators.ema20[i] })));
      ema50Series.setData(candles.map((c, i) => ({ time: c.time as any, value: indicators.ema50[i] })));
    }

    function paintSignal(candles: Candle[]) {
      const aiSignal = generateAISignal(candles);
      if (aiSignal.signal === 'HOLD') return;
      const aiMarkers = signalToMarker(candles, aiSignal.signal);
      setMarkers(aiMarkers);
      markerApi.setMarkers(aiMarkers);
    }

    async function load() {
      try {
        const response = await fetch(
          `/api/market/candles?ticker=${encodeURIComponent(ticker)}&timeframe=${encodeURIComponent(timeframe)}`,
          { cache: 'no-store' }
        );
        const data = await response.json();

        if (disposed) return;

        const candles: Candle[] = Array.isArray(data?.candles) ? data.candles : [];

        if (candles.length === 0) {
          setError(data?.note || data?.error || 'No candles returned');
          return;
        }

        setError('');
        const labels: Record<string, string> = {
          polygon: 'Polygon · live',
          'polygon-cached': 'Polygon · cached',
          'polygon-stale': 'Polygon · stale',
          demo: 'SIMULATED DATA',
        };
        setSource(`${labels[data.source] || data.source}${data.note ? ` · ${data.note}` : ''}`);
        setIsDemo(data.source === 'demo');

        candlesRef.current = candles;
        setCandles(candles);
        candleSeries.setData(candles as any);
        paintIndicators(candles);
        paintSignal(candles);
        chart?.timeScale().fitContent();

        disconnect = connectPolygonStream(
          ticker,
          (candle) => {
            if (disposed) return;
            candleSeries.update(candle as any);
            const previous = candlesRef.current;
            const merged =
              previous[previous.length - 1]?.time === candle.time
                ? [...previous.slice(0, -1), candle]
                : [...previous.slice(-500), candle];
            candlesRef.current = merged;
            setCandles(merged);
            paintIndicators(merged);
            paintSignal(merged);
          },
          timeframe
        );

        setLive(true);
      } catch (err: any) {
        if (!disposed) setError(err?.message || 'Failed to load candles');
      }
    }

    load();

    return () => {
      disposed = true;
      disconnect?.();
      setLive(false);
      markerApi.detach();
      chart?.remove();
      chart = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, timeframe]);

  return (
    <section className="chart-panel">
      <header className="chart-panel__header">
        <h3>
          {ticker} · {timeframe} · {error ? 'OFFLINE' : !source ? 'LOADING' : isDemo ? 'SIMULATED' : 'POLYGON'}
        </h3>
        <div className="chart-panel__timeframes">
          {TIMEFRAMES.map((tf) => (
            <button
              key={tf}
              type="button"
              className={tf === timeframe ? 'is-active' : ''}
              onClick={() => setTimeframe(tf)}
            >
              {tf}
            </button>
          ))}
        </div>
      </header>
      {error ? (
        <p className="chart-panel__error">{error}</p>
      ) : (
        <p className={isDemo ? 'chart-panel__warning' : 'chart-panel__meta'}>
          Source: {source || 'loading…'}
        </p>
      )}
      <div ref={containerRef} className="chart-panel__canvas" />
    </section>
  );
}
