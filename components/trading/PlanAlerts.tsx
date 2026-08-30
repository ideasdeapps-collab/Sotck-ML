'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { alertKey, evaluatePlanAlerts, type PlanAlert } from '@/lib/trading/dayTrading/planAlerts';
import { resolveOpenEntries } from '@/lib/trading/dayTrading/journal';
import type { IntradayPlan } from '@/lib/trading/dayTrading/intradayPlan';

/**
 * Watches the live price against the plan and says when something happened.
 *
 * Without this the plan only works while you are staring at the chart. The
 * price comes from the plan itself — `buildIntradayPlan` is recomputed on every
 * streamed candle — so no second subscription to Polygon is needed.
 *
 * Each alert fires once per level: the key includes the price, so a level that
 * moves when the ML data refreshes re-arms, but a level sitting still does not
 * shout on every tick.
 */

const MAX_LOG = 12;

const TONE_CLASS: Record<PlanAlert['tone'], string> = {
  good: 'is-good',
  bad: 'is-bad',
  info: 'is-info',
};

const clock = (time: number) =>
  new Date(time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });

type Props = { plan: IntradayPlan; ticker: string };

export default function PlanAlerts({ plan, ticker }: Props) {
  const previousPrice = useRef<number | null>(null);
  const fired = useRef(new Set<string>());

  const [log, setLog] = useState<PlanAlert[]>([]);
  const [notify, setNotify] = useState(false);
  const [permissionDenied, setPermissionDenied] = useState(false);

  // A plan for another ticker shares nothing with this one — not the levels,
  // not what has already fired.
  useEffect(() => {
    previousPrice.current = null;
    fired.current.clear();
    setLog([]);
  }, [ticker]);

  useEffect(() => {
    const price = plan.lastPrice;
    const previous = previousPrice.current;
    previousPrice.current = price;

    if (previous === null) return;

    // Close any journalled trade this move settled, plan or no plan on screen.
    resolveOpenEntries(ticker, price);

    const events = evaluatePlanAlerts(plan, previous, price, Date.now()).filter(
      (alert) => !fired.current.has(alertKey(alert))
    );

    if (events.length === 0) return;

    for (const alert of events) fired.current.add(alertKey(alert));
    setLog((current) => [...events.slice().reverse(), ...current].slice(0, MAX_LOG));

    if (notify && typeof Notification !== 'undefined' && Notification.permission === 'granted') {
      for (const alert of events) {
        new Notification(`${ticker} · ${alert.label}`, {
          body: `Precio ${alert.price.toFixed(2)} · nivel ${alert.level.toFixed(2)}`,
          tag: `${ticker}-${alertKey(alert)}`,
        });
      }
    }
  }, [plan, ticker, notify]);

  const toggleNotify = useCallback(async () => {
    if (notify) {
      setNotify(false);
      return;
    }

    if (typeof Notification === 'undefined') {
      setPermissionDenied(true);
      return;
    }

    const permission =
      Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();

    if (permission === 'granted') setNotify(true);
    else setPermissionDenied(true);
  }, [notify]);

  const armed: { label: string; level: number }[] = [
    { label: 'Entrada', level: plan.entryMid },
    { label: 'Stop Loss', level: plan.stopLoss },
    { label: 'TP1', level: plan.takeProfit[0] },
    { label: 'TP2', level: plan.takeProfit[1] },
  ];

  if (plan.scenarios.bullish) armed.push({ label: 'Trigger alcista', level: plan.scenarios.bullish.trigger });
  if (plan.scenarios.bearish) armed.push({ label: 'Trigger bajista', level: plan.scenarios.bearish.trigger });

  return (
    <>
      <div className="trade-plan__alerts-head">
        <h4>Alertas</h4>
        <button type="button" onClick={toggleNotify} className={notify ? 'is-active' : ''}>
          {notify ? 'Avisos activos' : 'Activar avisos'}
        </button>
      </div>

      {permissionDenied && (
        <p className="signals-panel__quiet">
          El navegador bloqueó las notificaciones — las alertas siguen apareciendo aquí abajo.
        </p>
      )}

      <ul className="trade-plan__armed">
        {armed.map((level) => {
          const distance = ((level.level - plan.lastPrice) / plan.lastPrice) * 100;
          return (
            <li key={level.label}>
              <span>{level.label}</span>
              <b>{level.level.toFixed(2)}</b>
              <small>
                {distance >= 0 ? '+' : ''}
                {distance.toFixed(2)}%
              </small>
            </li>
          );
        })}
      </ul>

      {log.length === 0 ? (
        <p className="signals-panel__quiet">Vigilando {armed.length} niveles con el precio en vivo.</p>
      ) : (
        <ul className="trade-plan__alert-log">
          {log.map((alert) => (
            <li key={`${alert.time}-${alertKey(alert)}`} className={TONE_CLASS[alert.tone]}>
              <small>{clock(alert.time)}</small> {alert.label} <b>{alert.price.toFixed(2)}</b>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
