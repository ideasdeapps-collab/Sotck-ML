import type { IntradayPlan } from './intradayPlan';

/**
 * Turns price movement into plan events: the entry zone being touched, the
 * stop or a target being hit, a scenario trigger giving way.
 *
 * Pure on purpose — it takes the previous price and the current one and says
 * what just happened between them. Deduping, notifying and logging are the
 * caller's job, which keeps this testable and lets the journal reuse the same
 * crossing logic to resolve trades it recorded hours earlier.
 */

export type AlertKind = 'entry' | 'stop' | 'tp1' | 'tp2' | 'bullish' | 'bearish';

export type PlanAlert = {
  kind: AlertKind;
  label: string;
  level: number;
  price: number;
  time: number;
  /** Severity, for colouring: an entry is information, a stop is not. */
  tone: 'good' | 'bad' | 'info';
};

/** Did the price move through `level` on the way up? */
export function crossedUp(previous: number, current: number, level: number): boolean {
  return previous < level && current >= level;
}

export function crossedDown(previous: number, current: number, level: number): boolean {
  return previous > level && current <= level;
}

/** A stable key per alert, so the same event does not fire on every tick. */
export function alertKey(alert: Pick<PlanAlert, 'kind' | 'level'>): string {
  return `${alert.kind}:${alert.level.toFixed(2)}`;
}

export function evaluatePlanAlerts(
  plan: IntradayPlan,
  previousPrice: number,
  price: number,
  time: number
): PlanAlert[] {
  if (!Number.isFinite(previousPrice) || !Number.isFinite(price) || previousPrice === price) return [];

  const long = plan.direction === 'long';
  const alerts: PlanAlert[] = [];

  const add = (kind: AlertKind, label: string, level: number, tone: PlanAlert['tone']) =>
    alerts.push({ kind, label, level, price, time, tone });

  // Entry: the move touching the band, from either side. Tested against the
  // whole segment rather than the endpoint, because a fast tick — or a coarse
  // timeframe — can jump clean through a band two ticks wide and never be
  // observed inside it.
  const [entryLow, entryHigh] = plan.entry;
  const wasInside = previousPrice >= entryLow && previousPrice <= entryHigh;
  const touchedBand =
    Math.max(previousPrice, price) >= entryLow && Math.min(previousPrice, price) <= entryHigh;

  if (!wasInside && touchedBand) {
    add('entry', long ? 'Precio en zona de COMPRA' : 'Precio en zona de VENTA', plan.entryMid, 'info');
  }

  // Stop and targets are directional: a long is stopped below, a short above.
  if (long ? crossedDown(previousPrice, price, plan.stopLoss) : crossedUp(previousPrice, price, plan.stopLoss)) {
    add('stop', 'Stop loss alcanzado', plan.stopLoss, 'bad');
  }

  const hitTarget = (level: number) =>
    long ? crossedUp(previousPrice, price, level) : crossedDown(previousPrice, price, level);

  if (hitTarget(plan.takeProfit[0])) add('tp1', 'Take Profit 1 alcanzado', plan.takeProfit[0], 'good');
  if (hitTarget(plan.takeProfit[1])) add('tp2', 'Take Profit 2 alcanzado', plan.takeProfit[1], 'good');

  // Scenario triggers fire regardless of the plan's own direction — that a
  // level gave way is exactly what the user wants to know about.
  const bullish = plan.scenarios.bullish;
  if (bullish && crossedUp(previousPrice, price, bullish.trigger)) {
    add('bullish', `Escenario alcista activado (> ${bullish.trigger})`, bullish.trigger, 'good');
  }

  const bearish = plan.scenarios.bearish;
  if (bearish && crossedDown(previousPrice, price, bearish.trigger)) {
    add('bearish', `Escenario bajista activado (< ${bearish.trigger})`, bearish.trigger, 'bad');
  }

  return alerts;
}
