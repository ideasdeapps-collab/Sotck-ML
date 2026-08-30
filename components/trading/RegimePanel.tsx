'use client';

import { useEffect, useState } from 'react';
import { useTradingStore } from '@/lib/trading/tradingStore';
import { fetchPremarket, fetchPsychology, fetchRegime } from '@/lib/trading/mlApi';
import type { PremarketResponse, PsychologyResponse, RegimeResponse } from '@/types/trading';

/**
 * Market context: regime, crowd psychology and the opening gap.
 *
 * Every number here comes from a module that already existed — `market_regime`
 * and `market_features` had no endpoint at all, and `premarket.py` was written
 * in full and then never imported by anything.
 */

const REGIME_COLOR: Record<string, string> = {
  BULLISH: '#22c55e',
  BEARISH: '#ef4444',
  SIDEWAYS: '#94a3b8',
  HIGH_VOLATILITY: '#f59e0b',
  TRANSITION: '#a78bfa',
};

function ipmColor(ipm: number) {
  if (ipm > 60) return '#ef4444'; // euphoria — contrarian sell zone
  if (ipm < -60) return '#22c55e'; // panic — contrarian buy zone
  return '#94a3b8';
}

export default function RegimePanel() {
  const { ticker } = useTradingStore();
  const [regime, setRegime] = useState<RegimeResponse | null>(null);
  const [psychology, setPsychology] = useState<PsychologyResponse | null>(null);
  const [premarket, setPremarket] = useState<PremarketResponse | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setRegime(null);
    setPsychology(null);
    setPremarket(null);
    setReason('');

    Promise.all([fetchRegime(ticker), fetchPsychology(ticker), fetchPremarket(ticker)]).then(
      ([regimeResult, psychologyResult, premarketResult]) => {
        if (cancelled) return;

        if (regimeResult.ok) setRegime(regimeResult.data);
        else setReason(regimeResult.reason);

        // Psychology and premarket need a trained model; a 404 here is normal
        // for an untrained ticker and must not blank the whole panel.
        if (psychologyResult.ok) setPsychology(psychologyResult.data);
        if (premarketResult.ok) setPremarket(premarketResult.data);

        setLoading(false);
      }
    );

    return () => {
      cancelled = true;
    };
  }, [ticker]);

  if (loading) {
    return (
      <section>
        <h3>Contexto · {ticker}</h3>
        <p>Clasificando régimen…</p>
      </section>
    );
  }

  if (!regime && !psychology && !premarket) {
    return (
      <section>
        <h3>Contexto · {ticker}</h3>
        <p className="panel__error">{reason || 'Sin contexto disponible'}</p>
      </section>
    );
  }

  const gap = premarket?.gap_pct;

  return (
    <section className="regime-panel">
      <h3>Contexto · {ticker}</h3>

      {regime && (
        <>
          <p className="regime-panel__badge" style={{ color: REGIME_COLOR[regime.regime] ?? '#94a3b8' }}>
            {regime.regime.replace(/_/g, ' ')} <small>({Math.round(regime.confidence * 100)}%)</small>
          </p>
          <p>
            RSI {regime.features.rsi} · momentum {regime.features.momentum} · vol ×{regime.features.volume_ratio}
          </p>
        </>
      )}

      {psychology && (
        <p>
          IPM <b style={{ color: ipmColor(psychology.ipm_now) }}>{psychology.ipm_now}</b> · {psychology.zone}
          {psychology.delta_ipm !== 0 && (
            <span> ({psychology.delta_ipm > 0 ? '+' : ''}{psychology.delta_ipm})</span>
          )}
        </p>
      )}

      {premarket &&
        (premarket.premarket_available && typeof gap === 'number' ? (
          <p>
            Gap premarket <b style={{ color: gap >= 0 ? '#22c55e' : '#ef4444' }}>{gap >= 0 ? '+' : ''}{gap}%</b>
            {premarket.models.xgb?.confirmation && <span> · XGB {premarket.models.xgb.confirmation}</span>}
            {premarket.models.mlp?.confirmation && <span> · MLP {premarket.models.mlp.confirmation}</span>}
          </p>
        ) : (
          <p className="regime-panel__quiet">Sin sesión premarket activa</p>
        ))}
    </section>
  );
}
