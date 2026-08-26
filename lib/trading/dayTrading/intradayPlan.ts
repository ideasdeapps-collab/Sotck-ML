import type { Candle } from '../marketData';
import type { Indicators } from '../indicators';

/**
 * Rule-based intraday trade plan: support/resistance zones, entry band, two
 * targets and a stop.
 *
 * The levels are NOT recomputed here. `api/intraday.py` already finds fractal
 * pivots and clusters them with a touch count, and `/patterns` returns that as
 * `support_resistance.zones` — this module only ranks those levels around the
 * current price and derives the operational part of the plan from them. One
 * clustering implementation, in Python, stays the single source of truth.
 *
 * Everything is a pure function of its input so the chart overlay and the
 * TradePlanPanel can call it with the same data and cannot disagree.
 *
 * ⚠️ Guía educativa basada en reglas, NO una recomendación de inversión — the
 * same caveat `api/trade_levels.py` carries.
 */

export type PlanBias = 'auto' | 'long' | 'short';
export type PlanDirection = 'long' | 'short';

/** One level from /patterns, widened into the band the market actually respects. */
export type PlanZone = {
  level: number;
  low: number;
  high: number;
  touches: number;
};

export type PlanScenario = {
  direction: PlanDirection;
  label: string;
  /** Price that has to give way for the scenario to be in play. */
  trigger: number;
  condition: string;
  targets: [number, number];
  stopLoss: number;
};

export type PlanCheck = {
  label: string;
  ok: boolean;
  detail: string;
};

export type IntradayPlan = {
  direction: PlanDirection;
  /** What the caller asked for — 'auto' means the direction was derived. */
  bias: PlanBias;
  lastPrice: number;
  entry: [number, number];
  entryMid: number;
  entryType: string;
  stopLoss: number;
  takeProfit: [number, number];
  riskReward: number;
  supportZone: PlanZone | null;
  resistanceZone: PlanZone | null;
  /** The two nearest levels either side of price, as the key-levels panel shows them. */
  levels: { s1: number | null; s2: number | null; r1: number | null; r2: number | null };
  scenarios: { bullish: PlanScenario | null; bearish: PlanScenario | null };
  checklist: PlanCheck[];
  rationale: string;
};

/** A level as `/patterns` reports it. */
export type SrZone = { type: string; price: number; touches?: number };

/**
 * The same levels as they arrive from `/intraday`, which is where `/patterns`
 * gets them from in the first place (`api/main.py` calls `analyze_intraday`).
 * The Lab reads `/intraday` directly so the plan does not depend on the newer
 * endpoint being deployed.
 */
export function zonesFromChartism(chartism?: {
  support?: { level: number; touches: number }[];
  resistance?: { level: number; touches: number }[];
}): SrZone[] {
  if (!chartism) return [];

  return [
    ...(chartism.support ?? []).map((level) => ({
      type: 'SUPPORT',
      price: level.level,
      touches: level.touches,
    })),
    ...(chartism.resistance ?? []).map((level) => ({
      type: 'RESISTANCE',
      price: level.level,
      touches: level.touches,
    })),
  ];
}

export type PlanInput = {
  candles: Candle[];
  indicators: Indicators;
  zones: SrZone[];
  /** `chartism.structure.trend` — "alcista (HH/HL)", "bajista (LH/LL)" or "lateral". */
  trend?: string;
  bias?: PlanBias;
};

const round = (value: number) => Math.round(value * 10000) / 10000;

/** Latest defined value of an indicator series — the head is NaN while it warms up. */
function lastFinite(values: number[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    if (Number.isFinite(values[i])) return values[i];
  }
  return null;
}

function closestTo(target: number, values: number[]): number {
  return values.reduce((best, value) =>
    Math.abs(value - target) < Math.abs(best - target) ? value : best
  );
}

/**
 * Collapses levels that sit within one band of each other.
 *
 * The API returns up to four supports and four resistances, and two clusters
 * 0.1% apart are one zone as far as a trader is concerned — drawing both makes
 * the chart noisier without adding information.
 */
function mergeLevels(zones: SrZone[], band: number): { price: number; touches: number }[] {
  const sorted = zones
    .filter((zone) => Number.isFinite(zone.price) && zone.price > 0)
    .map((zone) => ({ price: zone.price, touches: zone.touches ?? 1 }))
    .sort((a, b) => a.price - b.price);

  const merged: { price: number; touches: number }[] = [];

  for (const level of sorted) {
    const previous = merged[merged.length - 1];

    if (previous && Math.abs(level.price - previous.price) <= band) {
      const touches = previous.touches + level.touches;
      // Weight the merged price by touches: the level the market hit more often
      // is the one it is actually reacting to.
      previous.price = (previous.price * previous.touches + level.price * level.touches) / touches;
      previous.touches = touches;
      continue;
    }

    merged.push({ ...level });
  }

  return merged;
}

/** Confluence score: positive leans long, negative leans short. */
function directionScore(
  lastPrice: number,
  ema20: number | null,
  ema50: number | null,
  vwap: number | null,
  rsi: number | null,
  trend?: string
): number {
  let score = 0;

  if (vwap !== null) score += lastPrice > vwap ? 1 : -1;
  if (ema20 !== null && ema50 !== null) score += ema20 > ema50 ? 1 : -1;
  if (trend?.startsWith('alcista')) score += 1;
  else if (trend?.startsWith('bajista')) score -= 1;
  if (rsi !== null) {
    if (rsi > 55) score += 1;
    else if (rsi < 45) score -= 1;
  }

  return score;
}

function zoneAround(level: number | null, touches: number, band: number): PlanZone | null {
  if (level === null) return null;
  return {
    level: round(level),
    low: round(level - band),
    high: round(level + band),
    touches,
  };
}

export function buildIntradayPlan({
  candles,
  indicators,
  zones,
  trend,
  bias = 'auto',
}: PlanInput): IntradayPlan | null {
  const last = candles[candles.length - 1];
  if (!last || zones.length === 0) return null;

  const lastPrice = last.close;
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) return null;

  const atr = lastFinite(indicators.atr14);
  const ema20 = lastFinite(indicators.ema20);
  const ema50 = lastFinite(indicators.ema50);
  const vwap = lastFinite(indicators.vwapBands.vwap);
  const rsi = lastFinite(indicators.rsi14);

  // Half-width of every zone. 0.3% mirrors the `tol=0.003` that `cluster_levels`
  // in api/intraday.py uses to group pivots, so the band is never narrower than
  // the clustering that produced the level.
  const band = Math.max(lastPrice * 0.003, (atr ?? 0) * 0.25);
  const buffer = Math.max((atr ?? 0) * 0.5, lastPrice * 0.0015);

  // The ML API fetches its own bars, so a stale response — or the simulated
  // candles the chart falls back to without a Polygon key — can pair levels
  // with a price they have nothing to do with. Anything more than 20% away is
  // not a level for this chart.
  const relevant = zones.filter((zone) => Math.abs(zone.price - lastPrice) / lastPrice <= 0.2);
  if (relevant.length === 0) return null;

  // Levels are split by where they sit relative to price, not by the label the
  // API gave them: a support the price has already broken is a resistance now.
  const merged = mergeLevels(relevant, band);
  const below = merged.filter((level) => level.price < lastPrice).sort((a, b) => b.price - a.price);
  const above = merged.filter((level) => level.price > lastPrice).sort((a, b) => a.price - b.price);

  if (below.length === 0 && above.length === 0) return null;

  const s1 = below[0]?.price ?? null;
  const s2 = below[1]?.price ?? null;
  const r1 = above[0]?.price ?? null;
  const r2 = above[1]?.price ?? null;

  // --- Direction ----------------------------------------------------------
  const score = directionScore(lastPrice, ema20, ema50, vwap, rsi, trend);
  let direction: PlanDirection;

  if (bias !== 'auto') {
    direction = bias;
  } else if (score !== 0) {
    direction = score > 0 ? 'long' : 'short';
  } else if (s1 !== null && r1 !== null) {
    // Dead heat: side with whichever level the price is further from, i.e. the
    // one it has more room to travel towards.
    direction = lastPrice - s1 > r1 - lastPrice ? 'short' : 'long';
  } else {
    direction = r1 !== null ? 'long' : 'short';
  }

  const long = direction === 'long';

  // --- Entry zone ---------------------------------------------------------
  // The retest reference: the moving average, VWAP or level the price is about
  // to trade against. Anything further than two bands away is not a retest of
  // anything, so it is ignored and the entry is simply "at market".
  const references = [ema20, vwap, long ? s1 : r1].filter(
    (value): value is number => value !== null && Number.isFinite(value)
  );
  const near = references.filter((value) => Math.abs(value - lastPrice) <= band * 2);
  const anchor = near.length > 0 ? closestTo(lastPrice, near) : lastPrice;

  const pad = band * 0.2;
  const entryLow = round(Math.min(anchor, lastPrice) - pad);
  const entryHigh = round(Math.max(anchor, lastPrice) + pad);
  const entryMid = (entryLow + entryHigh) / 2;

  const entryType =
    near.length === 0
      ? long
        ? 'Compra a mercado con confirmación'
        : 'Venta a mercado con confirmación'
      : anchor === s1 || anchor === r1
        ? long
          ? 'Compra (rebote en soporte)'
          : 'Venta (rechazo en resistencia)'
        : long
          ? 'Compra (breakout + retesteo sobre EMA20/VWAP)'
          : 'Venta (breakdown + retesteo bajo EMA20/VWAP)';

  // --- Stop -----------------------------------------------------------------
  // The stop hides behind the structure only when that structure is close
  // enough to be this entry's actual invalidation. Anchoring to a level two
  // bands away turns a scalp into a trade with no risk control — that is what
  // produced R:R 0.28 setups before.
  const reach = band * 1.5;
  const structural = long
    ? s1 !== null && s1 >= entryLow - reach
      ? s1
      : null
    : r1 !== null && r1 <= entryHigh + reach
      ? r1
      : null;

  const stopBase = long
    ? Math.min(structural ?? entryLow - (atr ?? lastPrice * 0.005), entryLow)
    : Math.max(structural ?? entryHigh + (atr ?? lastPrice * 0.005), entryHigh);

  const stopLoss = round(long ? stopBase - buffer : stopBase + buffer);

  // --- Targets ---------------------------------------------------------------
  const risk = Math.abs(entryMid - stopLoss);
  // With no level left to aim at, project the risk instead — a plan without a
  // target is not a plan.
  const projected = (multiple: number) => (long ? entryMid + risk * multiple : entryMid - risk * multiple);

  // A level closer than the risk taken (or than one band) is noise, not an
  // objective; the plan aims at the next one out instead.
  const minTargetDistance = Math.max(band, risk);
  const reachesTarget = (level: number) =>
    long ? level - entryMid >= minTargetDistance : entryMid - level >= minTargetDistance;

  const firstTarget = long
    ? (above.find((level) => reachesTarget(level.price))?.price ?? projected(2))
    : (below.find((level) => reachesTarget(level.price))?.price ?? projected(2));

  const secondCandidate = long
    ? above.find((level) => level.price > firstTarget)?.price
    : below.find((level) => level.price < firstTarget)?.price;

  const secondTarget =
    secondCandidate ?? (long
      ? firstTarget + (firstTarget - entryMid)
      : firstTarget - (entryMid - firstTarget));

  const takeProfit: [number, number] = [round(firstTarget), round(secondTarget)];
  const riskReward = risk > 0 ? Math.round((Math.abs(takeProfit[0] - entryMid) / risk) * 100) / 100 : 0;

  // --- Scenarios (both sides, always) ---------------------------------------
  const bullish: PlanScenario | null =
    r1 === null
      ? null
      : {
          direction: 'long',
          label: 'ALCISTA',
          trigger: round(r1),
          condition: `Precio > ${round(r1)}`,
          targets: [
            round(r2 ?? r1 + (atr ?? r1 * 0.005) * 2),
            round(above[2]?.price ?? (r2 ?? r1) + (atr ?? r1 * 0.005) * 3),
          ],
          stopLoss: round(s1 !== null ? s1 - buffer : r1 - (atr ?? r1 * 0.01)),
        };

  const bearish: PlanScenario | null =
    s1 === null
      ? null
      : {
          direction: 'short',
          label: 'BAJISTA',
          trigger: round(s1),
          condition: `Precio < ${round(s1)}`,
          targets: [
            round(s2 ?? s1 - (atr ?? s1 * 0.005) * 2),
            round(below[2]?.price ?? (s2 ?? s1) - (atr ?? s1 * 0.005) * 3),
          ],
          stopLoss: round(r1 !== null ? r1 + buffer : s1 + (atr ?? s1 * 0.01)),
        };

  // --- Confirmation checklist ------------------------------------------------
  const avgVolume =
    candles.slice(-20).reduce((sum, candle) => sum + (candle.volume || 0), 0) /
    Math.min(candles.length, 20);

  const checklist: PlanCheck[] = [
    {
      label: long ? 'Precio sobre VWAP' : 'Precio bajo VWAP',
      ok: vwap !== null && (long ? lastPrice > vwap : lastPrice < vwap),
      detail: vwap === null ? 'VWAP no disponible' : `${round(lastPrice)} vs ${round(vwap)}`,
    },
    {
      label: long ? 'EMA20 > EMA50' : 'EMA20 < EMA50',
      ok: ema20 !== null && ema50 !== null && (long ? ema20 > ema50 : ema20 < ema50),
      detail:
        ema20 === null || ema50 === null
          ? 'Medias no disponibles'
          : `${round(ema20)} / ${round(ema50)}`,
    },
    {
      label: long ? 'RSI > 50' : 'RSI < 50',
      ok: rsi !== null && (long ? rsi > 50 : rsi < 50),
      detail: rsi === null ? 'RSI no disponible' : `RSI(14) ${Math.round(rsi * 10) / 10}`,
    },
    {
      label: 'Volumen sobre su media 20',
      ok: avgVolume > 0 && (last.volume || 0) > avgVolume,
      detail:
        avgVolume > 0
          ? `${Math.round(last.volume || 0).toLocaleString('en-US')} vs ${Math.round(avgVolume).toLocaleString('en-US')}`
          : 'Sin volumen',
    },
  ];

  const rationale =
    `${entryType}. Objetivos en las resistencias/soportes con más toques y stop ` +
    `al otro lado de ${long ? 'el soporte' : 'la resistencia'} más cercano. ` +
    'Guía educativa basada en reglas, no es una recomendación de inversión.';

  return {
    direction,
    bias,
    lastPrice: round(lastPrice),
    entry: [entryLow, entryHigh],
    entryMid: round(entryMid),
    entryType,
    stopLoss,
    takeProfit,
    riskReward,
    supportZone: zoneAround(s1, below[0]?.touches ?? 0, band),
    resistanceZone: zoneAround(r1, above[0]?.touches ?? 0, band),
    levels: {
      s1: s1 === null ? null : round(s1),
      s2: s2 === null ? null : round(s2),
      r1: r1 === null ? null : round(r1),
      r2: r2 === null ? null : round(r2),
    },
    scenarios: { bullish, bearish },
    checklist,
    rationale,
  };
}
