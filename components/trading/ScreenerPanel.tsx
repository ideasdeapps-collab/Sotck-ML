'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTradingStore } from '@/lib/trading/tradingStore';
import { fetchSignals } from '@/lib/trading/mlApi';
import { loadCapabilities } from '@/lib/trading/capabilities';
import type { SignalsResponse } from '@/types/trading';

/**
 * Ranks the whole watchlist by confluence score, so the Lab answers "where is
 * the opportunity today", not only "what about this one ticker".
 *
 * The scan runs client-side, one ticker at a time, rather than through
 * `/signals-scan`. That endpoint does the same work server-side but in a single
 * request: `scan_watchlist` in api/signals.py loops sequentially and spends two
 * Polygon calls per ticker, which blows through the 60s `maxDuration` on the
 * `/api/ml` proxy long before a 17-ticker watchlist is done. Scanning from here
 * has no such ceiling, shows rows as they land, and each `/signals` response is
 * cached by the proxy for 60s — so picking a ticker afterwards is instant.
 *
 * Tickers without a trained XGBoost model are skipped rather than requested:
 * `combined_signals` needs the daily bias, so it 404s on them. With the default
 * watchlist that is five of seven symbols — five pointless round trips and an
 * error list longer than the results.
 */

type Row = {
  ticker: string;
  verdict: string;
  score: number;
  dailyBias: string;
  trend: string;
  lastPrice: number;
  topAlert: string | null;
  alignedCount: number;
};

type Failure = { ticker: string; reason: string };

/** Polygon is shared with the chart stream; two at a time keeps it civil. */
const CONCURRENCY = 2;

const VERDICT_COLOR: Record<string, string> = {
  'STRONG BUY': '#22c55e',
  BUY: '#4ade80',
  NEUTRAL: '#94a3b8',
  SELL: '#f87171',
  'STRONG SELL': '#ef4444',
};

function toRow(ticker: string, data: SignalsResponse): Row {
  const aligned = data.alerts.filter((alert) => alert.aligned_with_daily);
  const top = aligned[0] ?? data.alerts[0] ?? null;

  return {
    ticker,
    verdict: data.verdict.label,
    score: data.verdict.score,
    dailyBias: data.daily_bias.label,
    trend: data.intraday_structure.trend,
    lastPrice: data.last_price,
    topAlert: top ? `${top.direction} · ${top.trigger.replace(/_/g, ' ')} @ ${top.level}` : null,
    alignedCount: aligned.length,
  };
}

export default function ScreenerPanel() {
  const { ticker, watchlist, setTicker } = useTradingStore();

  const [rows, setRows] = useState<Row[]>([]);
  const [failures, setFailures] = useState<Failure[]>([]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(0);
  const [scanning, setScanning] = useState(false);

  // A scan in flight has to be abandonable: the watchlist can change, or the
  // user can leave, long before a slow upstream finishes.
  const runRef = useRef(0);

  const scan = useCallback(async () => {
    const run = ++runRef.current;

    setScanning(true);
    setRows([]);
    setFailures([]);
    setSkipped([]);
    setDone(0);
    setTotal(0);

    const capabilities = await loadCapabilities();
    if (runRef.current !== run) return;

    if (!capabilities.reachable) {
      setFailures([{ ticker: '—', reason: capabilities.reason || 'API de ML no disponible' }]);
      setScanning(false);
      return;
    }

    const targets = watchlist.filter((symbol) => capabilities.xgb.has(symbol.toUpperCase()));
    setSkipped(watchlist.filter((symbol) => !capabilities.xgb.has(symbol.toUpperCase())));
    setTotal(targets.length);

    let next = 0;

    const worker = async () => {
      while (next < targets.length) {
        const symbol = targets[next++];
        const result = await fetchSignals(symbol);

        if (runRef.current !== run) return;

        if (result.ok) {
          setRows((current) =>
            [...current, toRow(symbol, result.data)].sort((a, b) => Math.abs(b.score) - Math.abs(a.score))
          );
        } else {
          setFailures((current) => [...current, { ticker: symbol, reason: result.reason }]);
        }

        setDone((count) => count + 1);
      }
    };

    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, worker));

    if (runRef.current === run) setScanning(false);
  }, [watchlist]);

  // Abandon whatever is in flight on unmount so no state lands on a dead panel.
  useEffect(() => () => void ++runRef.current, []);

  return (
    <section className="screener">
      <header className="screener__header">
        <h3>Screener · watchlist</h3>
        <button type="button" onClick={scan} disabled={scanning || watchlist.length === 0}>
          {scanning ? `Escaneando ${done}/${total || watchlist.length}…` : 'Escanear'}
        </button>
      </header>

      {rows.length === 0 && !scanning && (
        <p className="signals-panel__quiet">
          Cruza el sesgo diario con la estructura intradía de los {watchlist.length} tickers de tu watchlist y los
          ordena por fuerza de la señal.
        </p>
      )}

      {rows.length > 0 && (
        <ol className="screener__rows">
          {rows.map((row) => (
            <li key={row.ticker} className={row.ticker === ticker ? 'is-active' : ''}>
              <button type="button" onClick={() => setTicker(row.ticker)}>
                <span className="screener__ticker">{row.ticker}</span>
                <span className="screener__verdict" style={{ color: VERDICT_COLOR[row.verdict] ?? '#94a3b8' }}>
                  {row.verdict} <small>({row.score})</small>
                </span>
                <span className="screener__detail">
                  {row.topAlert ?? `${row.dailyBias} · ${row.trend}`}
                  {row.alignedCount > 0 && <b> · {row.alignedCount} alineadas</b>}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}

      {skipped.length > 0 && (
        <p className="signals-panel__quiet">
          Sin modelo entrenado, fuera del escaneo: {skipped.join(', ')}
        </p>
      )}

      {failures.length > 0 && (
        <p className="panel__error">
          Sin datos: {failures.map((failure) => `${failure.ticker} (${failure.reason})`).join(' · ')}
        </p>
      )}
    </section>
  );
}
