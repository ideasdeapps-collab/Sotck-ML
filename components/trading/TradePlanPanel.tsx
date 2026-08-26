'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTradingStore } from '@/lib/trading/tradingStore';
import { calculateIndicators } from '@/lib/trading/indicators';
import { fetchIntraday } from '@/lib/trading/mlApi';
import { intervalFor } from '@/lib/trading/overlays/remoteData';
import {
  buildIntradayPlan,
  zonesFromChartism,
  type PlanBias,
  type PlanScenario,
} from '@/lib/trading/dayTrading/intradayPlan';
import { planTrade } from '@/lib/trading/dayTrading/positionSize';
import { recordPlan } from '@/lib/trading/dayTrading/journal';
import PlanAlerts from './PlanAlerts';
import type { Candle } from '@/lib/trading/marketData';
import type { IntradayResponse } from '@/types/trading';

/**
 * The numbers behind the plan drawn on the chart.
 *
 * It calls `buildIntradayPlan` with the same candles and the same `/intraday`
 * response the overlay uses, so the panel and the chart cannot show different
 * levels. Fetching its own copy (like SignalsPanel and RegimePanel already do)
 * keeps it working while the chart overlay is switched off; the `/api/ml` proxy
 * caches `/intraday` for 30s, so it is not a second round trip.
 */

const INTRADAY = ['1m', '5m', '15m', '1h'];
const BIASES: { id: PlanBias; label: string }[] = [
  { id: 'auto', label: 'Auto' },
  { id: 'long', label: 'Largo' },
  { id: 'short', label: 'Corto' },
];

const money = (value: number) =>
  value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const price = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—';

function Scenario({ scenario }: { scenario: PlanScenario }) {
  const bullish = scenario.direction === 'long';

  return (
    <div className={`trade-plan__scenario ${bullish ? 'is-bullish' : 'is-bearish'}`}>
      <h5>{scenario.label}</h5>
      <p className="trade-plan__condition">
        Condición <b>{scenario.condition}</b>
      </p>
      <dl>
        <div>
          <dt>Objetivo 1</dt>
          <dd>{price(scenario.targets[0])}</dd>
        </div>
        <div>
          <dt>Objetivo 2</dt>
          <dd>{price(scenario.targets[1])}</dd>
        </div>
        <div>
          <dt>Stop Loss</dt>
          <dd>{price(scenario.stopLoss)}</dd>
        </div>
      </dl>
    </div>
  );
}

export default function TradePlanPanel() {
  const { ticker, timeframe, candles, capital, planBias, setPlanBias, riskPerTrade, setRiskPerTrade } =
    useTradingStore();

  const [intraday, setIntraday] = useState<IntradayResponse | null>(null);
  const [reason, setReason] = useState('');
  const [loading, setLoading] = useState(true);

  const intradayTimeframe = INTRADAY.includes(timeframe);

  useEffect(() => {
    if (!intradayTimeframe) {
      setIntraday(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setIntraday(null);
    setReason('');

    const interval = intervalFor(timeframe);

    fetchIntraday(ticker, interval, interval >= 15 ? 2 : 1).then((result) => {
      if (cancelled) return;
      if (result.ok) setIntraday(result.data);
      else setReason(result.reason);
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [ticker, timeframe, intradayTimeframe]);

  const plan = useMemo(() => {
    const series = candles as Candle[];
    if (!intraday || series.length === 0) return null;

    return buildIntradayPlan({
      candles: series,
      indicators: calculateIndicators(series),
      zones: zonesFromChartism(intraday.chartism),
      trend: intraday.chartism?.structure?.trend,
      bias: planBias,
    });
  }, [intraday, candles, planBias]);

  if (!intradayTimeframe) {
    return (
      <section className="trade-plan">
        <h3>Plan intradía · {ticker}</h3>
        <p className="signals-panel__quiet">Solo en 1m / 5m / 15m / 1h — el plan se apoya en la estructura intradía.</p>
      </section>
    );
  }

  if (loading) {
    return (
      <section className="trade-plan">
        <h3>Plan intradía · {ticker}</h3>
        <p>Calculando niveles y escenarios…</p>
      </section>
    );
  }

  if (!plan) {
    return (
      <section className="trade-plan">
        <h3>Plan intradía · {ticker}</h3>
        <p className="panel__error">
          {reason || 'Estructura insuficiente para un plan operativo — sin soportes ni resistencias claros.'}
        </p>
      </section>
    );
  }

  const long = plan.direction === 'long';
  const sizing = planTrade(plan.entryMid, plan.stopLoss, plan.takeProfit[0], capital, riskPerTrade);
  const notional = sizing.shares * plan.entryMid;

  return (
    <section className="trade-plan">
      <header className="trade-plan__header">
        <h3>Plan intradía · {ticker}</h3>
        <div className="trade-plan__bias">
          {BIASES.map((option) => (
            <button
              key={option.id}
              type="button"
              className={option.id === planBias ? 'is-active' : ''}
              onClick={() => setPlanBias(option.id)}
            >
              {option.label}
            </button>
          ))}
        </div>
      </header>

      <p className={`trade-plan__direction ${long ? 'is-bullish' : 'is-bearish'}`}>
        {long ? 'COMPRA' : 'VENTA'} <small>{plan.entryType}</small>
      </p>

      {/* --- Niveles clave --- */}
      <h4>Niveles clave</h4>
      <dl className="trade-plan__levels">
        <div>
          <dt>Resistencia 2</dt>
          <dd className="is-bearish">{price(plan.levels.r2)}</dd>
        </div>
        <div>
          <dt>Resistencia 1</dt>
          <dd className="is-bearish">{price(plan.levels.r1)}</dd>
        </div>
        <div>
          <dt>Último precio</dt>
          <dd>{price(plan.lastPrice)}</dd>
        </div>
        <div>
          <dt>Soporte 1</dt>
          <dd className="is-bullish">{price(plan.levels.s1)}</dd>
        </div>
        <div>
          <dt>Soporte 2</dt>
          <dd className="is-bullish">{price(plan.levels.s2)}</dd>
        </div>
      </dl>

      {/* --- Escenarios --- */}
      <h4>Escenarios</h4>
      <div className="trade-plan__scenarios">
        {plan.scenarios.bullish && <Scenario scenario={plan.scenarios.bullish} />}
        {plan.scenarios.bearish && <Scenario scenario={plan.scenarios.bearish} />}
      </div>

      {/* --- Confirmación --- */}
      <h4>Confirmación</h4>
      <ul className="trade-plan__checklist">
        {plan.checklist.map((check) => (
          <li key={check.label} className={check.ok ? 'is-ok' : 'is-pending'}>
            <span>{check.ok ? '✓' : '✗'}</span> {check.label} <small>{check.detail}</small>
          </li>
        ))}
      </ul>

      {/* --- Entrada y gestión --- */}
      <h4>Entrada y gestión</h4>
      <dl className="trade-plan__levels">
        <div>
          <dt>Entrada</dt>
          <dd>
            {price(plan.entry[0])} – {price(plan.entry[1])}
          </dd>
        </div>
        <div>
          <dt>Stop Loss</dt>
          <dd className="is-bearish">{price(plan.stopLoss)}</dd>
        </div>
        <div>
          <dt>Take Profit 1</dt>
          <dd className="is-bullish">{price(plan.takeProfit[0])}</dd>
        </div>
        <div>
          <dt>Take Profit 2</dt>
          <dd className="is-bullish">{price(plan.takeProfit[1])}</dd>
        </div>
        <div>
          <dt>Relación R/R</dt>
          <dd>1:{plan.riskReward}</dd>
        </div>
      </dl>

      <label className="trade-plan__risk">
        Riesgo por trade
        <input
          type="number"
          min={0.1}
          max={5}
          step={0.1}
          value={+(riskPerTrade * 100).toFixed(2)}
          onChange={(event) => {
            const percent = Number(event.target.value);
            if (Number.isFinite(percent) && percent > 0) setRiskPerTrade(percent / 100);
          }}
        />
        %
      </label>

      <p>
        Tamaño de posición: <b>{sizing.shares.toLocaleString('en-US')}</b> acciones ·{' '}
        {money(notional)} <small>(riesgo {money(sizing.riskAmount)})</small>
      </p>

      {!sizing.approved && <p className="panel__error">Setup no aprobado — {sizing.reason}</p>}

      <button
        type="button"
        className="trade-plan__save"
        onClick={() =>
          recordPlan(plan, {
            ticker,
            timeframe,
            shares: sizing.shares,
            riskAmount: sizing.riskAmount,
          })
        }
      >
        Guardar en el diario
      </button>

      <PlanAlerts plan={plan} ticker={ticker} />

      <p className="signals-panel__quiet">{plan.rationale}</p>
    </section>
  );
}
