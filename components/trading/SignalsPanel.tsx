'use client';

import { useEffect, useState } from 'react';
import { useTradingStore } from '@/lib/trading/tradingStore';
import { fetchSignals } from '@/lib/trading/mlApi';
import type { SignalsResponse } from '@/types/trading';

/**
 * Confluence between the daily XGBoost bias and the intraday structure.
 *
 * All of this is computed by `api/signals.py`, which the recharts dashboard
 * has been using for a while; the Trading Lab simply had no window onto it.
 */

const VERDICT_COLOR: Record<string, string> = {
  'STRONG BUY': '#22c55e',
  BUY: '#4ade80',
  NEUTRAL: '#94a3b8',
  SELL: '#f87171',
  'STRONG SELL': '#ef4444',
};

/** Inline sparkline of the confluence score — green above zero, red below. */
function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return null;

  const width = 220;
  const height = 44;
  const min = Math.min(...values, -1);
  const max = Math.max(...values, 1);
  const span = max - min || 1;

  const x = (index: number) => (index / (values.length - 1)) * width;
  const y = (value: number) => height - ((value - min) / span) * height;

  const path = values.map((value, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(value).toFixed(1)}`).join(' ');
  const zero = y(0);
  const last = values[values.length - 1];

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="signals-panel__spark" role="img" aria-label="Curva de confluencia">
      <line x1={0} y1={zero} x2={width} y2={zero} stroke="rgba(148,163,184,0.4)" strokeDasharray="3 3" />
      <path d={path} fill="none" stroke={last >= 0 ? '#22c55e' : '#ef4444'} strokeWidth={1.5} />
    </svg>
  );
}

export default function SignalsPanel() {
  const { ticker } = useTradingStore();
  const [data, setData] = useState<SignalsResponse | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setData(null);
    setReason('');

    fetchSignals(ticker).then((result) => {
      if (cancelled) return;
      if (result.ok) setData(result.data);
      else setReason(result.reason);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [ticker]);

  if (loading) {
    return (
      <section>
        <h3>Señales · {ticker}</h3>
        <p>Cruzando sesgo diario con estructura intradía…</p>
      </section>
    );
  }

  if (!data) {
    return (
      <section>
        <h3>Señales · {ticker}</h3>
        <p className="panel__error">{reason || 'Sin señales disponibles'}</p>
      </section>
    );
  }

  const aligned = data.alerts.filter((alert) => alert.aligned_with_daily);

  return (
    <section className="signals-panel">
      <h3>Señales · {ticker}</h3>

      <p className="signals-panel__verdict" style={{ color: VERDICT_COLOR[data.verdict.label] ?? '#94a3b8' }}>
        {data.verdict.label} <small>({data.verdict.score})</small>
      </p>

      <Sparkline values={data.signal_curve.map((point) => point.score_ema)} />

      <p>
        Diario: {data.daily_bias.label} ({data.daily_bias.predicted_next_pct >= 0 ? '+' : ''}
        {data.daily_bias.predicted_next_pct}% · conf. {Math.round(data.daily_bias.confidence * 100)}%)
      </p>
      <p>Intradía: {data.intraday_structure.trend}</p>

      {data.alerts.length === 0 ? (
        <p className="signals-panel__quiet">Sin breakouts confirmados con volumen.</p>
      ) : (
        <ul className="signals-panel__alerts">
          {data.alerts.slice(0, 4).map((alert) => (
            <li key={`${alert.time}-${alert.level}`} className={alert.aligned_with_daily ? 'is-aligned' : ''}>
              <b>{alert.direction}</b> · {alert.trigger.replace(/_/g, ' ')} @ {alert.level}
              {alert.aligned_with_daily && <span> ✓ alineada con diario</span>}
            </li>
          ))}
        </ul>
      )}

      {aligned.length > 0 && <p className="signals-panel__quiet">{aligned.length} de alta confianza</p>}
    </section>
  );
}
