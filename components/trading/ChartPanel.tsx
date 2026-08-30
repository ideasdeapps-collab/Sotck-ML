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
import { calibrate, elliottProbabilitySeries } from '@/lib/trading/priceAction/elliottStart';
import { useCopilot } from '@/lib/trading/copilot/store';
import { ownedBy, usePortfolio } from '@/lib/trading/paperEngine';
import type { CopilotOverlay } from '@/lib/trading/overlays/paint';
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
    setDataSource,
    candles,
    overlays,
    planBias,
    capabilities,
    apiReachable,
    setCapabilities,
  } = useTradingStore();

  const copilotState = useCopilot();
  const portfolio = usePortfolio();

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
          setDataSource('');
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
        // The copilot needs the raw source, not the label: it will not trade
        // synthetic candles.
        setDataSource(String(data.source || ''));

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

  /**
   * Lo que el copiloto tiene y ha hecho en este ticker.
   *
   * Se arma aquí, y no en el panel del copiloto, porque el gráfico es el que
   * pinta: `paintOverlays` recibe una foto y no conoce ni el motor ni el store.
   */
  const copilotOverlay = useMemo<CopilotOverlay>(() => {
    const position = ownedBy(portfolio, 'copilot', ticker)[0] ?? null;

    const fills = copilotState.events
      .filter(
        (event) =>
          event.ticker === ticker &&
          event.candleTime !== undefined &&
          (event.kind === 'open' || event.kind === 'close')
      )
      .map((event) => ({
        time: event.candleTime as number,
        kind: event.kind as 'open' | 'close',
        label: event.kind === 'open' ? 'COPILOTO' : 'SALIDA',
        direction: event.levels?.direction ?? (position?.side ?? 'long'),
      }))
      .sort((a, b) => a.time - b.time);

    return {
      position: position
        ? {
            entry: position.entry,
            stop: position.stop,
            target: position.target,
            target2: position.target2,
            side: position.side,
          }
        : null,
      fills,
    };
  }, [ticker, copilotState.events, portfolio]);

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
      bias: planBias,
      copilot: copilotOverlay,
    });
  }, [candles, overlays, remote, allowed, planBias, copilotOverlay]);

  /**
   * Resumen del oscilador de Elliott.
   *
   * Llama a las mismas funciones puras que `paintOverlays`, igual que
   * `TradePlanPanel` comparte `buildIntradayPlan` con su overlay: la leyenda y la
   * curva no pueden decir cosas distintas. Solo se calcula con el overlay
   * encendido, que es cuando hay algo que explicar.
   */
  const elliott = useMemo(() => {
    if (!overlays.elliottStart || !allowed('elliottStart') || candles.length === 0) return null;

    const series = candles as Candle[];
    const { candidates, current } = elliottProbabilitySeries({
      candles: series,
      indicators: calculateIndicators(series),
    });

    return current ? { current, buckets: calibrate(candidates) } : null;
  }, [candles, overlays.elliottStart, allowed]);

  const elliottLegend = (() => {
    if (!elliott) return '';

    const { current, buckets } = elliott;
    const state =
      current.state === 'confirmed'
        ? 'confirmado — onda 3 en marcha'
        : current.state === 'invalidated'
          ? 'invalidado'
          : 'formando';
    const direction = current.direction === 'long' ? 'alcista' : 'bajista';

    const history = buckets
      .filter((bucket) => bucket.total > 0)
      .map((bucket) => `${bucket.confirmed}/${bucket.total} confirmados (≥${bucket.threshold}%)`)
      .join(' · ');

    return (
      `Elliott · ${current.probability}% · ${state} (${direction}) · ` +
      `dispara en ${current.trigger.toFixed(2)}, invalida en ${current.invalidation.toFixed(2)}` +
      (history ? ` — histórico: ${history}` : ' — sin histórico suficiente')
    );
  })();

  /**
   * Avisos de la curva de 1 minuto.
   *
   * El retraso del plan Starter y una exactitud direccional en torno al 50 %
   * cambian por completo cómo hay que leer esa línea, así que van donde se lee
   * — no enterrados en el JSON de la respuesta.
   */
  const oneMinuteLegend = (() => {
    const result = remote.oneMinute;
    if (!overlays.intraday1m || !allowed('intraday1m') || !result?.ok) return '';

    const data = result.data;
    const hora = new Date(data.last_real_time).toLocaleTimeString('es-ES', {
      hour: '2-digit',
      minute: '2-digit',
    });
    const acierto = data.model_meta?.directional_accuracy;

    // El acierto puede faltar (sin meta_1m_<ticker>.json entrenado) o venir
    // como cifra cruda que a un lector desprevenido le suena a ventaja. Las
    // dos situaciones se resuelven con la misma cautela explícita, para que
    // la ausencia de dato no calle la advertencia.
    const lecturaAcierto =
      acierto != null
        ? `acierto direccional ${(acierto * 100).toFixed(0)}% — a un minuto, un valor cercano al 50% es ruido, no ventaja`
        : 'sin acierto direccional reportado para este ticker — trátalo con la misma cautela que un 50%';

    return (
      `Curva ML 1m · última barra real ${hora} · +${data.horizon_min} min · ${lecturaAcierto}` +
      ' — datos con ~15 min de retraso (plan Starter); contexto, no señal de entrada'
    );
  })();

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

      {elliottLegend && <p className="chart-panel__elliott">{elliottLegend}</p>}
      {oneMinuteLegend && <p className="chart-panel__onemin">{oneMinuteLegend}</p>}

      {overlayErrors.length > 0 && (
        <p className="chart-panel__error">Overlays sin datos — {overlayErrors.join(' · ')}</p>
      )}

      <div ref={containerRef} className="chart-panel__canvas" />
    </section>
  );
}
