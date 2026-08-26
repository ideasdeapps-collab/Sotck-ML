'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickSeries,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type Time,
} from 'lightweight-charts';
import { useTradingStore } from '@/lib/trading/tradingStore';
import { connectPolygonStream } from '@/lib/trading/polygonStream';
import { calculateIndicators } from '@/lib/trading/indicators';
import { fetchJson } from '@/lib/trading/fetchJson';
import { capabilitiesFor, loadCapabilities } from '@/lib/trading/capabilities';
import { createOverlayLayer, type OverlayLayer } from '@/lib/trading/overlays/layer';
import { paintOverlays } from '@/lib/trading/overlays/paint';
import { loadRemoteOverlays, requiredSources, type RemoteOverlayData } from '@/lib/trading/overlays/remoteData';
import { OVERLAYS, blockedReason, type OverlayId } from '@/lib/trading/overlays/registry';
import OverlayControls from './OverlayControls';
import type { Candle } from '@/lib/trading/marketData';

const TIMEFRAMES = ['1m', '5m', '15m', '1h', '1d'];

type ChartHandles = {
  chart: IChartApi;
  candleSeries: ISeriesApi<'Candlestick', Time>;
  layer: OverlayLayer;
};

export default function ChartPanel() {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const handlesRef = useRef<ChartHandles | null>(null);
  const candlesRef = useRef<Candle[]>([]);

  const {
    ticker,
    timeframe,
    setTimeframe,
    setCandles,
    setLive,
    setDataError,
    candles,
    overlays,
    capabilities,
    apiReachable,
    setCapabilities,
  } = useTradingStore();

  const [source, setSource] = useState('');
  const [isDemo, setIsDemo] = useState(false);
  const [error, setError] = useState('');
  const [remote, setRemote] = useState<RemoteOverlayData>({});
  const [loadingOverlays, setLoadingOverlays] = useState(false);

  /** Why each overlay is (or is not) available right now. */
  const blocked = useMemo(() => {
    const map = {} as Record<OverlayId, string | null>;
    for (const overlay of OVERLAYS) {
      map[overlay.id] = blockedReason(overlay, timeframe, capabilities, apiReachable);
    }
    return map;
  }, [timeframe, capabilities, apiReachable]);

  const allowed = useCallback((id: OverlayId) => blocked[id] === null, [blocked]);

  // --- Chart lifecycle: created once, never rebuilt for a data change ------
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
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

    handlesRef.current = { chart, candleSeries, layer: createOverlayLayer(chart, candleSeries) };

    return () => {
      handlesRef.current?.layer.destroy();
      handlesRef.current = null;
      chart.remove();
    };
  }, []);

  // --- Which curves exist for this ticker ---------------------------------
  useEffect(() => {
    let cancelled = false;

    loadCapabilities().then((map) => {
      if (cancelled) return;
      setCapabilities(map.reachable ? capabilitiesFor(map, ticker) : null, map.reachable);
    });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker]);

  // --- Candles + live polling ---------------------------------------------
  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles) return;

    let disconnect: (() => void) | undefined;
    let disposed = false;

    const load = async () => {
      try {
        const data = await fetchJson(
          `/api/market/candles?ticker=${encodeURIComponent(ticker)}&timeframe=${encodeURIComponent(timeframe)}`
        );

        if (disposed) return;

        const loaded: Candle[] = Array.isArray(data?.candles) ? data.candles : [];

        if (loaded.length === 0) {
          const reason = data?.note || data?.error || 'No candles returned';
          setError(reason);
          setDataError(reason);
          return;
        }

        setError('');
        setDataError('');

        const labels: Record<string, string> = {
          polygon: 'Polygon · live',
          'polygon-cached': 'Polygon · cached',
          'polygon-stale': 'Polygon · stale',
          demo: 'SIMULATED DATA',
        };
        setSource(`${labels[data.source] || data.source}${data.note ? ` · ${data.note}` : ''}`);
        setIsDemo(data.source === 'demo');

        candlesRef.current = loaded;
        setCandles(loaded);
        handles.candleSeries.setData(loaded as never);
        handles.chart.timeScale().fitContent();

        disconnect = connectPolygonStream(
          ticker,
          (candle) => {
            if (disposed) return;

            handles.candleSeries.update(candle as never);

            const previous = candlesRef.current;
            const merged =
              previous[previous.length - 1]?.time === candle.time
                ? [...previous.slice(0, -1), candle]
                : [...previous.slice(-500), candle];

            candlesRef.current = merged;
            setCandles(merged);
          },
          timeframe
        );

        setLive(true);
      } catch (err: any) {
        if (disposed) return;
        const reason = err?.message || 'Failed to load candles';
        setError(reason);
        setDataError(reason);
      }
    };

    load();

    return () => {
      disposed = true;
      disconnect?.();
      setLive(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, timeframe]);

  // --- Remote overlay data -------------------------------------------------
  const sources = useMemo(() => requiredSources(overlays, allowed), [overlays, allowed]);
  const sourceKey = sources.join(',');

  useEffect(() => {
    if (sources.length === 0) {
      setRemote({});
      setLoadingOverlays(false);
      return;
    }

    let cancelled = false;
    // Drop the previous ticker's curves before the new ones arrive, otherwise
    // they stay painted over candles they have nothing to do with.
    setRemote({});
    setLoadingOverlays(true);

    loadRemoteOverlays(ticker, timeframe, sources)
      .then((data) => {
        if (!cancelled) setRemote(data);
      })
      .finally(() => {
        if (!cancelled) setLoadingOverlays(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticker, timeframe, sourceKey]);

  // --- Paint ---------------------------------------------------------------
  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles || candles.length === 0) return;

    paintOverlays({
      layer: handles.layer,
      candles: candles as Candle[],
      indicators: calculateIndicators(candles as Candle[]),
      enabled: overlays,
      allowed,
      remote,
    });
  }, [candles, overlays, remote, allowed]);

  /** Failures that the toggles alone cannot explain. */
  const overlayErrors = Object.entries(remote)
    .filter(([, result]) => result && !result.ok)
    .map(([key, result]) => `${key}: ${(result as { reason: string }).reason}`);

  return (
    <section className="chart-panel">
      <header className="chart-panel__header">
        <h3>
          {ticker} · {timeframe} · {error ? 'OFFLINE' : !source ? 'LOADING' : isDemo ? 'SIMULATED' : 'POLYGON'}
        </h3>
        <div className="chart-panel__controls">
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
          <OverlayControls blocked={blocked} loading={loadingOverlays} />
        </div>
      </header>

      {error ? (
        <p className="chart-panel__error">{error}</p>
      ) : (
        <p className={isDemo ? 'chart-panel__warning' : 'chart-panel__meta'}>Source: {source || 'loading…'}</p>
      )}

      {overlayErrors.length > 0 && (
        <p className="chart-panel__error">Overlays sin datos — {overlayErrors.join(' · ')}</p>
      )}

      <div ref={containerRef} className="chart-panel__canvas" />
    </section>
  );
}
