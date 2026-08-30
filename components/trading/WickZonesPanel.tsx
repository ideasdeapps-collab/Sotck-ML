'use client';

import { useMemo } from 'react';
import { useTradingStore } from '@/lib/trading/tradingStore';
import { calculateIndicators } from '@/lib/trading/indicators';
import { planTrade } from '@/lib/trading/dayTrading/positionSize';
import { recordPlan } from '@/lib/trading/dayTrading/journal';
import {
  buildWickSetup,
  detectWickZones,
  MIN_WICK_RATIO,
  type WickZone,
  type ZoneStatus,
} from '@/lib/trading/priceAction/wickZones';
import type { Candle } from '@/lib/trading/marketData';

/**
 * Los números detrás de las zonas de mecha dibujadas en el gráfico.
 *
 * A diferencia de `TradePlanPanel`, aquí no hay fetch: la estrategia se calcula
 * entera sobre las velas que ya están en el store, con las mismas funciones puras
 * que usa el overlay — así el panel y el gráfico no pueden mostrar niveles
 * distintos, y todo sigue funcionando con el overlay apagado o sin API de ML.
 */

const STATUS: Record<ZoneStatus, { label: string; className: string }> = {
  active: { label: 'RETESTEO', className: 'is-active' },
  armed: { label: 'ARMADA', className: 'is-armed' },
  pending: { label: 'EN CURSO', className: 'is-pending' },
  mitigated: { label: 'MITIGADA', className: 'is-mitigated' },
};

const money = (value: number) =>
  value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });

const price = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '—';

function Zone({ zone }: { zone: WickZone }) {
  const status = STATUS[zone.status];
  const demand = zone.side === 'demand';

  return (
    <li className={`wick-zones__zone ${status.className}`}>
      <span className={demand ? 'is-bullish' : 'is-bearish'}>{demand ? 'COMPRA' : 'VENTA'}</span>
      <b>
        {price(zone.bottom)} – {price(zone.top)}
      </b>
      <em>{status.label}</em>
      <small>
        mecha {Math.round(zone.wickRatio * 100)}% · impulso {zone.impulse.toFixed(1)} ATR · hace {zone.age}{' '}
        velas
      </small>
    </li>
  );
}

export default function WickZonesPanel() {
  const { ticker, timeframe, candles, capital, riskPerTrade, setRiskPerTrade } = useTradingStore();

  const { zones, setup } = useMemo(() => {
    const series = candles as Candle[];
    if (series.length === 0) return { zones: [] as WickZone[], setup: null };

    const indicators = calculateIndicators(series);
    const detected = detectWickZones({ candles: series, indicators });

    return { zones: detected, setup: buildWickSetup(detected, { candles: series, indicators }) };
  }, [candles]);

  if (zones.length === 0) {
    return (
      <section className="trade-plan wick-zones">
        <h3>Estrategia de mechas · {ticker}</h3>
        <p className="signals-panel__quiet">
          Sin mechas relevantes en las velas cargadas — prueba otra temporalidad.
        </p>
      </section>
    );
  }

  const long = setup?.direction === 'long';
  const sizing = setup
    ? planTrade(setup.entryMid, setup.stopLoss, setup.takeProfit[0], capital, riskPerTrade)
    : null;

  return (
    <section className="trade-plan wick-zones">
      <h3>Estrategia de mechas · {ticker}</h3>

      {setup ? (
        <>
          <p className={`trade-plan__direction ${long ? 'is-bullish' : 'is-bearish'}`}>
            {long ? 'COMPRA' : 'VENTA'} <small>{setup.entryType}</small>
          </p>

          <h4>Zona y gestión</h4>
          <dl className="trade-plan__levels">
            <div>
              <dt>Zona de mecha</dt>
              <dd>
                {price(setup.entry[0])} – {price(setup.entry[1])}
              </dd>
            </div>
            <div>
              <dt>Entrada</dt>
              <dd>{price(setup.entryMid)}</dd>
            </div>
            <div>
              <dt>Stop Loss</dt>
              <dd className="is-bearish">{price(setup.stopLoss)}</dd>
            </div>
            <div>
              <dt>Take Profit 1</dt>
              <dd className="is-bullish">{price(setup.takeProfit[0])}</dd>
            </div>
            <div>
              <dt>Take Profit 2</dt>
              <dd className="is-bullish">{price(setup.takeProfit[1])}</dd>
            </div>
            <div>
              <dt>Relación R/R</dt>
              <dd>1:{setup.riskReward}</dd>
            </div>
          </dl>

          <h4>Confirmación</h4>
          <ul className="trade-plan__checklist">
            {setup.checklist.map((check) => (
              <li key={check.label} className={check.ok ? 'is-ok' : 'is-pending'}>
                <span>{check.ok ? '✓' : '✗'}</span> {check.label} <small>{check.detail}</small>
              </li>
            ))}
          </ul>

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

          {sizing && (
            <p>
              Tamaño de posición: <b>{sizing.shares.toLocaleString('en-US')}</b> acciones ·{' '}
              {money(sizing.shares * setup.entryMid)} <small>(riesgo {money(sizing.riskAmount)})</small>
            </p>
          )}

          {sizing && !sizing.approved && <p className="panel__error">Setup no aprobado — {sizing.reason}</p>}

          <button
            type="button"
            className="trade-plan__save"
            onClick={() =>
              recordPlan(setup, {
                ticker,
                timeframe,
                shares: sizing?.shares ?? 0,
                riskAmount: sizing?.riskAmount ?? 0,
              })
            }
          >
            Guardar en el diario
          </button>
        </>
      ) : (
        <p className="signals-panel__quiet">
          Ninguna zona está lo bastante cerca del precio para operarla — vigila las de abajo y espera el
          regreso.
        </p>
      )}

      <h4>Zonas detectadas</h4>
      <ul className="wick-zones__list">
        {zones.map((zone) => (
          <Zone key={zone.id} zone={zone} />
        ))}
      </ul>

      <p className="signals-panel__quiet">
        {setup?.rationale ??
          `Una mecha de al menos el ${Math.round(MIN_WICK_RATIO * 100)}% del rango marca dónde entró ` +
            'capital y quedaron órdenes sin ejecutar; la entrada se busca cuando el precio regresa a esa ' +
            'zona. Guía educativa basada en reglas, no es una recomendación de inversión.'}
      </p>
    </section>
  );
}
