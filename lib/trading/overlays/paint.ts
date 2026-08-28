import type { SeriesMarker, Time } from 'lightweight-charts';
import type { Candle } from '../marketData';
import type { Indicators } from '../indicators';
import { toChartTime } from '../chartTime';
import { calculateOpeningRange } from '../dayTrading/openingRange';
import { previousDayLevels, sessionSegments } from '../dayTrading/sessions';
import { buildIntradayPlan, zonesFromChartism, type PlanBias } from '../dayTrading/intradayPlan';
import { buildWickSetup, detectWickZones, type WickZone } from '../priceAction/wickZones';
import { elliottProbabilitySeries } from '../priceAction/elliottStart';
import type { OverlayLayer, LinePoint, PriceLineSpec } from './layer';
import type { Box } from './boxPrimitive';
import type { OverlayId, OverlayState } from './registry';
import type { RemoteOverlayData } from './remoteData';
import type { CurvePoint } from '@/types/trading';

/**
 * Draws (or clears) every overlay for the current state.
 *
 * Deliberately a plain function over the whole state rather than per-overlay
 * effects: the chart is one shared surface, and reasoning about "what should be
 * on screen right now" in one pass is far easier to keep correct than a dozen
 * independent subscriptions racing each other.
 */

const COLORS = {
  ema20: '#38bdf8',
  ema50: '#f59e0b',
  vwap: '#a78bfa',
  vwapBand: 'rgba(167,139,250,0.45)',
  bollinger: 'rgba(148,163,184,0.7)',
  openingRange: '#38bdf8',
  prevDay: '#94a3b8',
  support: '#22c55e',
  resistance: '#ef4444',
  bullish: '#22c55e',
  bearish: '#ef4444',
  orderBlock: '#facc15',
  xgb: '#22d3ee',
  mlp: '#f472b6',
  extended: '#fb923c',
  band: 'rgba(148,163,184,0.75)',
  bandInner: 'rgba(203,213,225,0.9)',
  session: '#e879f9',
  fib: '#eab308',
  zigzag: '#94a3b8',
  sma20: '#60a5fa',
  sma50: '#a3e635',
  sma200: '#f87171',
  planEntry: '#38bdf8',
  planStop: '#ef4444',
  planTarget: '#22c55e',
  // Teal/naranja a propósito: las zonas de mecha comparten pantalla con el plan
  // intradía, y en verde/rojo se confundirían con soporte y resistencia.
  wickDemand: '#14b8a6',
  wickSupply: '#f97316',
  // El mismo morado que ya usa el overlay «ZigZag + Elliott», para que se lean
  // como la misma familia.
  elliott: '#c084fc',
  elliottRef: 'rgba(148,163,184,0.4)',
} as const;

/** Every layer id an overlay can own, so toggling it off removes all of them. */
const LAYER_IDS: Record<OverlayId, string[]> = {
  plan: ['plan-support', 'plan-resistance', 'plan-entry-zone', 'plan-levels', 'plan-entry-marker'],
  ema: ['ema20', 'ema50'],
  vwap: ['vwap', 'vwap+1', 'vwap-1', 'vwap+2', 'vwap-2'],
  bollinger: ['bb-upper', 'bb-lower'],
  openingRange: ['or-box', 'or-breakout'],
  prevDay: ['pdl'],
  sessions: ['session-shading'],
  levels: ['sr-levels', 'breakouts'],
  zones: ['fvg', 'order-blocks', 'liquidity'],
  priceAction: ['price-action'],
  wickZones: ['wick-zones', 'wick-markers', 'wick-setup'],
  xgb: ['curve-xgb'],
  mlp: ['curve-mlp'],
  extended: ['curve-extended'],
  montecarlo: ['mc-p5', 'mc-p25', 'mc-p75', 'mc-p95'],
  sessionCurve: ['curve-session'],
  fibonacci: ['fib-levels'],
  zigzag: ['zigzag', 'elliott'],
  sma: ['sma20', 'sma50', 'sma200'],
  elliottStart: ['elliott-prob', 'elliott-prob-50', 'elliott-prob-70', 'elliott-waves', 'elliott-outcome'],
};

/** Panel propio del oscilador de Elliott, debajo de las velas. */
const ELLIOTT_PANE = 1;

export type PaintInput = {
  layer: OverlayLayer;
  candles: Candle[];
  indicators: Indicators;
  enabled: OverlayState;
  /** False when the overlay is blocked (wrong timeframe, no model, API down). */
  allowed: (id: OverlayId) => boolean;
  remote: RemoteOverlayData;
  /** Direction the trade plan is drawn for; 'auto' derives it from confluence. */
  bias?: PlanBias;
};

/**
 * Maps a foreign timestamp onto the bar that contains it.
 *
 * The ML API fetches its own bars from Polygon, so an intraday marker can land
 * a few seconds off the chart's bar boundary — and lightweight-charts silently
 * drops anything that is not on the time scale. Snapping to the last bar at or
 * before the timestamp is what makes the structure overlays actually appear.
 */
function snapper(candles: Candle[]) {
  const times = candles.map((candle) => candle.time);

  return (value: string | number): Time | null => {
    let target: number;
    try {
      target = Number(toChartTime(value));
    } catch {
      return null;
    }

    if (times.length === 0 || target < times[0]) return null;

    let low = 0;
    let high = times.length - 1;
    let found = -1;

    while (low <= high) {
      const mid = (low + high) >> 1;
      if (times[mid] <= target) {
        found = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }

    return found === -1 ? null : (times[found] as Time);
  };
}

/** Series values aligned with the candles, skipping non-finite entries. */
function alignedLine(candles: Candle[], values: number[]): LinePoint[] {
  const points: LinePoint[] = [];
  for (let i = 0; i < candles.length && i < values.length; i++) {
    if (Number.isFinite(values[i])) points.push({ time: candles[i].time as Time, value: values[i] });
  }
  return points;
}

/** A predicted curve, anchored to the last known close so it does not float. */
function curveLine(anchorDate: string, anchorClose: number, points: CurvePoint[]): LinePoint[] {
  const line: LinePoint[] = [];

  try {
    line.push({ time: toChartTime(anchorDate), value: anchorClose });
  } catch {
    // An unparseable anchor is not fatal; the curve just starts at its first point.
  }

  for (const point of points) {
    try {
      line.push({ time: toChartTime(point.date), value: point.close });
    } catch {
      // skip malformed points rather than dropping the whole curve
    }
  }

  return dedupe(line);
}

/** lightweight-charts rejects duplicate or unsorted times. */
function dedupe(points: LinePoint[]): LinePoint[] {
  const sorted = [...points].sort((a, b) => Number(a.time) - Number(b.time));
  return sorted.filter((point, index) => index === 0 || Number(point.time) !== Number(sorted[index - 1].time));
}

/**
 * La vela que imprimió la mecha y, si el precio ya volvió, el retesteo.
 *
 * Solo se marca el retesteo de las zonas vivas: en las mitigadas la caja ya
 * termina ahí, y un segundo marcador sobre cada una llenaría el gráfico de ruido.
 */
function wickMarkers(zones: WickZone[]): SeriesMarker<Time>[] {
  const markers: SeriesMarker<Time>[] = [];

  for (const zone of zones) {
    const demand = zone.side === 'demand';

    markers.push({
      time: zone.time as Time,
      position: demand ? 'belowBar' : 'aboveBar',
      color: demand ? COLORS.wickDemand : COLORS.wickSupply,
      shape: demand ? 'arrowUp' : 'arrowDown',
      text: 'MECHA',
    });

    if (zone.status === 'active' && zone.retestTime !== null) {
      markers.push({
        time: zone.retestTime as Time,
        position: demand ? 'belowBar' : 'aboveBar',
        color: demand ? COLORS.wickDemand : COLORS.wickSupply,
        shape: 'circle',
        text: 'RETESTEO',
      });
    }
  }

  return markers;
}

export function paintOverlays({
  layer,
  candles,
  indicators,
  enabled,
  allowed,
  remote,
  bias = 'auto',
}: PaintInput): void {
  const snap = snapper(candles);
  const last = candles[candles.length - 1];

  const on = (id: OverlayId) => enabled[id] && allowed(id);
  const clear = (id: OverlayId) => LAYER_IDS[id].forEach((layerId) => layer.remove(layerId));

  // --- Indicators ---------------------------------------------------------
  if (on('ema')) {
    layer.line('ema20', alignedLine(candles, indicators.ema20), { color: COLORS.ema20, lineWidth: 1, title: 'EMA20' });
    layer.line('ema50', alignedLine(candles, indicators.ema50), { color: COLORS.ema50, lineWidth: 1, title: 'EMA50' });
  } else clear('ema');

  if (on('vwap')) {
    const bands = indicators.vwapBands;
    layer.line('vwap', alignedLine(candles, bands.vwap), { color: COLORS.vwap, lineWidth: 2, title: 'VWAP' });
    layer.line('vwap+1', alignedLine(candles, bands.upper1), { color: COLORS.vwapBand, lineWidth: 1, dashed: true });
    layer.line('vwap-1', alignedLine(candles, bands.lower1), { color: COLORS.vwapBand, lineWidth: 1, dashed: true });
    layer.line('vwap+2', alignedLine(candles, bands.upper2), { color: COLORS.vwapBand, lineWidth: 1, dashed: true });
    layer.line('vwap-2', alignedLine(candles, bands.lower2), { color: COLORS.vwapBand, lineWidth: 1, dashed: true });
  } else clear('vwap');

  if (on('bollinger')) {
    layer.line('bb-upper', alignedLine(candles, indicators.bollinger.upper), { color: COLORS.bollinger, lineWidth: 1 });
    layer.line('bb-lower', alignedLine(candles, indicators.bollinger.lower), { color: COLORS.bollinger, lineWidth: 1 });
  } else clear('bollinger');

  // --- Day trading --------------------------------------------------------
  if (on('openingRange')) {
    const range = calculateOpeningRange(candles, 15);

    if (range) {
      layer.boxes('or-box', [
        {
          from: range.from as Time,
          to: range.to as Time,
          top: range.high,
          bottom: range.low,
          fill: 'rgba(56,189,248,0.08)',
          border: 'rgba(56,189,248,0.55)',
          label: `OR ${range.minutes}m`,
        },
      ]);

      layer.markers(
        'or-breakout',
        range.breakout
          ? [
              {
                time: range.breakout.time as Time,
                position: range.breakout.direction === 'UP' ? 'belowBar' : 'aboveBar',
                color: range.breakout.direction === 'UP' ? COLORS.bullish : COLORS.bearish,
                shape: range.breakout.direction === 'UP' ? 'arrowUp' : 'arrowDown',
                text: 'ORB',
              },
            ]
          : []
      );
    } else {
      clear('openingRange');
    }
  } else clear('openingRange');

  if (on('prevDay')) {
    const levels = previousDayLevels(candles);
    layer.priceLines(
      'pdl',
      levels
        ? [
            { price: levels.high, color: COLORS.prevDay, title: 'PDH', dashed: true },
            { price: levels.low, color: COLORS.prevDay, title: 'PDL', dashed: true },
            { price: levels.close, color: COLORS.prevDay, title: 'PDC', dashed: true },
          ]
        : []
    );
  } else clear('prevDay');

  if (on('sessions')) {
    const priceLow = Math.min(...candles.map((candle) => candle.low));
    const priceHigh = Math.max(...candles.map((candle) => candle.high));

    layer.boxes(
      'session-shading',
      sessionSegments(candles)
        .filter((segment) => segment.session !== 'regular')
        .map((segment) => ({
          from: segment.from as Time,
          to: segment.to as Time,
          top: priceHigh,
          bottom: priceLow,
          fill: segment.session === 'premarket' ? 'rgba(56,189,248,0.05)' : 'rgba(148,163,184,0.05)',
          border: 'rgba(148,163,184,0.12)',
        }))
    );
  } else clear('sessions');

  // --- Structure (from /patterns) -----------------------------------------
  const patterns = remote.patterns?.ok ? remote.patterns.data : null;

  // --- Trade plan ----------------------------------------------------------
  const intraday = remote.intraday?.ok ? remote.intraday.data : null;

  const plan =
    on('plan') && intraday
      ? buildIntradayPlan({
          candles,
          indicators,
          zones: zonesFromChartism(intraday.chartism),
          trend: intraday.chartism?.structure?.trend,
          bias,
        })
      : null;

  if (plan && last) {
    const from = candles[0].time as Time;
    const long = plan.direction === 'long';

    layer.boxes(
      'plan-support',
      plan.supportZone
        ? [
            {
              from,
              to: null,
              top: plan.supportZone.high,
              bottom: plan.supportZone.low,
              fill: 'rgba(34,197,94,0.10)',
              border: 'rgba(34,197,94,0.55)',
              label: 'SOPORTE INTRADÍA',
              dashed: true,
            },
          ]
        : []
    );

    layer.boxes(
      'plan-resistance',
      plan.resistanceZone
        ? [
            {
              from,
              to: null,
              top: plan.resistanceZone.high,
              bottom: plan.resistanceZone.low,
              fill: 'rgba(239,68,68,0.10)',
              border: 'rgba(239,68,68,0.55)',
              label: 'RESISTENCIA INTRADÍA',
              labelAlign: 'right',
              dashed: true,
            },
          ]
        : []
    );

    layer.boxes('plan-entry-zone', [
      {
        from,
        to: null,
        top: plan.entry[1],
        bottom: plan.entry[0],
        fill: 'rgba(56,189,248,0.14)',
        border: 'rgba(56,189,248,0.7)',
        label: long ? 'ENTRADA COMPRA' : 'ENTRADA VENTA',
      },
    ]);

    layer.priceLines('plan-levels', [
      { price: plan.entryMid, color: COLORS.planEntry, title: 'Entrada', width: 2 },
      { price: plan.stopLoss, color: COLORS.planStop, title: 'SL', width: 2, dashed: true },
      { price: plan.takeProfit[0], color: COLORS.planTarget, title: 'TP1', width: 2, dashed: true },
      { price: plan.takeProfit[1], color: COLORS.planTarget, title: 'TP2', dashed: true },
    ]);

    layer.markers('plan-entry-marker', [
      {
        time: last.time as Time,
        position: long ? 'belowBar' : 'aboveBar',
        color: long ? COLORS.bullish : COLORS.bearish,
        shape: long ? 'arrowUp' : 'arrowDown',
        text: long ? 'ENTRADA COMPRA' : 'ENTRADA VENTA',
      },
    ]);
  } else clear('plan');

  // --- Mechas (zonas de rechazo) -------------------------------------------
  // Se calcula en local sobre las velas ya cargadas, así que está disponible en
  // cualquier temporalidad y también sin API de ML.
  if (on('wickZones')) {
    const zones = detectWickZones({ candles, indicators });

    layer.boxes(
      'wick-zones',
      zones.map((zone) => {
        const demand = zone.side === 'demand';
        const rgb = demand ? '20,184,166' : '249,115,22';
        const strong = zone.status === 'active' || zone.status === 'armed';
        const fillAlpha = zone.status === 'active' ? 0.16 : zone.status === 'armed' ? 0.1 : 0.04;
        const borderAlpha = zone.status === 'active' ? 0.75 : zone.status === 'armed' ? 0.55 : 0.28;

        return {
          from: zone.time as Time,
          // Una zona ya consumida deja de proyectarse hacia la derecha: sigue
          // siendo referencia histórica, pero no compite con las que aún
          // esperan al precio.
          to: zone.status === 'mitigated' ? ((zone.retestTime ?? zone.time) as Time) : null,
          top: zone.top,
          bottom: zone.bottom,
          fill: `rgba(${rgb},${fillAlpha})`,
          border: `rgba(${rgb},${borderAlpha})`,
          label: `${demand ? 'MECHA COMPRA' : 'MECHA VENTA'}${zone.status === 'active' ? ' · RETESTEO' : ''}`,
          labelAlign: demand ? 'left' : 'right',
          dashed: !strong,
        };
      })
    );

    layer.markers('wick-markers', wickMarkers(zones));

    const setup = buildWickSetup(zones, { candles, indicators });

    layer.priceLines(
      'wick-setup',
      setup
        ? [
            { price: setup.entryMid, color: COLORS.planEntry, title: 'Entrada mecha', width: 2 },
            { price: setup.stopLoss, color: COLORS.planStop, title: 'SL', width: 2, dashed: true },
            { price: setup.takeProfit[0], color: COLORS.planTarget, title: 'TP1', width: 2, dashed: true },
            { price: setup.takeProfit[1], color: COLORS.planTarget, title: 'TP2', dashed: true },
          ]
        : []
    );
  } else clear('wickZones');

  if (on('levels') && patterns) {
    const zones = patterns.support_resistance?.zones ?? [];
    layer.priceLines(
      'sr-levels',
      zones.map((zone) => ({
        price: zone.price,
        color: zone.type === 'SUPPORT' ? COLORS.support : COLORS.resistance,
        title: `${zone.type === 'SUPPORT' ? 'S' : 'R'} ×${zone.touches ?? 1}`,
        // More touches = a level the market has respected more often.
        width: Math.min(Math.max(zone.touches ?? 1, 1), 4) as 1 | 2 | 3 | 4,
      }))
    );

    const breakoutMarkers: SeriesMarker<Time>[] = [];
    for (const breakout of patterns.breakouts ?? []) {
      const time = snap(breakout.time);
      if (!time) continue;
      const bullish = breakout.type.includes('alcista');
      breakoutMarkers.push({
        time,
        position: bullish ? 'belowBar' : 'aboveBar',
        color: bullish ? COLORS.bullish : COLORS.bearish,
        shape: 'circle',
        text: bullish ? 'BO' : 'BD',
      });
    }
    layer.markers('breakouts', breakoutMarkers);
  } else clear('levels');

  if (on('zones') && patterns) {
    const fvgBoxes: Box[] = [];
    for (const gap of patterns.fvg_rectangles ?? []) {
      const time = gap.time ? snap(gap.time) : null;
      if (!time || !last) continue;
      const bullish = gap.type === 'BULLISH_FVG';
      fvgBoxes.push({
        from: time,
        to: last.time as Time,
        top: gap.top,
        bottom: gap.bottom,
        fill: bullish ? 'rgba(34,197,94,0.10)' : 'rgba(239,68,68,0.10)',
        border: bullish ? 'rgba(34,197,94,0.45)' : 'rgba(239,68,68,0.45)',
        label: 'FVG',
      });
    }
    layer.boxes('fvg', fvgBoxes);

    const blockBoxes: Box[] = [];
    for (const block of patterns.order_blocks ?? []) {
      const time = block.time ? snap(block.time) : null;
      if (!time || !last) continue;
      blockBoxes.push({
        from: time,
        to: last.time as Time,
        top: block.high,
        bottom: block.low,
        fill: 'rgba(250,204,21,0.10)',
        border: 'rgba(250,204,21,0.5)',
        label: 'OB',
      });
    }
    layer.boxes('order-blocks', blockBoxes);

    const liquidity = patterns.liquidity_markers;
    const sweepTime = liquidity?.time ? snap(liquidity.time) : null;
    layer.markers(
      'liquidity',
      liquidity && liquidity.signal !== 'NONE' && sweepTime
        ? [
            {
              time: sweepTime,
              position: liquidity.signal === 'LIQUIDITY_SWEEP_UP' ? 'aboveBar' : 'belowBar',
              color: COLORS.orderBlock,
              shape: 'square',
              text: liquidity.signal === 'LIQUIDITY_SWEEP_UP' ? 'Sweep ↑' : 'Sweep ↓',
            },
          ]
        : []
    );
  } else clear('zones');

  if (on('priceAction') && patterns) {
    const markers: SeriesMarker<Time>[] = [];
    for (const pattern of patterns.price_action ?? []) {
      const time = snap(pattern.time);
      if (!time) continue;
      const bullish = pattern.bias === 'alcista';
      const bearish = pattern.bias === 'bajista';
      markers.push({
        time,
        position: bullish ? 'belowBar' : 'aboveBar',
        color: bullish ? COLORS.bullish : bearish ? COLORS.bearish : '#94a3b8',
        shape: bullish ? 'arrowUp' : bearish ? 'arrowDown' : 'circle',
        text: pattern.pattern.replace(/_/g, ' '),
      });
    }
    layer.markers('price-action', markers);
  } else clear('priceAction');

  // --- Predictive curves --------------------------------------------------
  const paintCurve = (id: OverlayId, layerId: string, color: string, title: string) => {
    const result = remote[id === 'xgb' ? 'xgb' : id === 'mlp' ? 'mlp' : 'extended'];
    if (!on(id) || !result?.ok) {
      clear(id);
      return;
    }
    const curve = result.data;
    layer.line(layerId, curveLine(curve.last_date, curve.last_close, curve.prediction), {
      color,
      lineWidth: 2,
      dashed: true,
      title,
    });
  };

  paintCurve('xgb', 'curve-xgb', COLORS.xgb, 'XGBoost');
  paintCurve('mlp', 'curve-mlp', COLORS.mlp, 'MLP');
  paintCurve('extended', 'curve-extended', COLORS.extended, 'AH+PM');

  const forecast = remote.forecast?.ok ? remote.forecast.data : null;
  if (on('montecarlo') && forecast) {
    const dates = forecast.prediction.prediction.map((point) => point.date);
    const anchorDate = forecast.prediction.last_date;
    const anchor = forecast.simulation.s0;

    const band = (values: number[]): LinePoint[] =>
      curveLine(
        anchorDate,
        anchor,
        // The simulation arrays are positional: index i is day i of the forecast.
        values.slice(0, dates.length).map((close, index) => ({ date: dates[index], close }))
      );

    layer.line('mc-p5', band(forecast.simulation.p5), { color: COLORS.band, lineWidth: 1, dashed: true, title: 'P5' });
    layer.line('mc-p95', band(forecast.simulation.p95), { color: COLORS.band, lineWidth: 1, dashed: true, title: 'P95' });
    layer.line('mc-p25', band(forecast.simulation.p25), { color: COLORS.bandInner, lineWidth: 1, dashed: true });
    layer.line('mc-p75', band(forecast.simulation.p75), { color: COLORS.bandInner, lineWidth: 1, dashed: true });
  } else clear('montecarlo');

  const session = remote.session?.ok ? remote.session.data : null;
  if (on('sessionCurve') && session) {
    const points: LinePoint[] = [];
    const lastReal = session.real[session.real.length - 1];

    if (lastReal) {
      const time = snap(lastReal.time);
      if (time) points.push({ time, value: lastReal.close });
    }

    for (const point of session.predicted) {
      try {
        points.push({ time: toChartTime(point.time), value: point.close });
      } catch {
        // skip
      }
    }

    layer.line('curve-session', dedupe(points), { color: COLORS.session, lineWidth: 2, dashed: true, title: 'Sesión ML' });
  } else clear('sessionCurve');

  // --- Elliott: probabilidad de inicio -------------------------------------
  // Local sobre las velas cargadas, en un panel propio bajo el gráfico porque
  // 0–100 % y el precio no comparten escala.
  if (on('elliottStart')) {
    const { series, current } = elliottProbabilitySeries({ candles, indicators });

    layer.line(
      'elliott-prob',
      series.map((point) => ({ time: point.time as Time, value: point.value })),
      {
        color: COLORS.elliott,
        lineWidth: 2,
        title: 'Prob. inicio Elliott',
        pane: ELLIOTT_PANE,
        fixedRange: { min: 0, max: 100 },
      }
    );

    // Referencias como series planas y no como price lines: los price lines
    // cuelgan de `anchorSeries`, que vive en el panel de las velas.
    const edges: LinePoint[] = series.length
      ? [
          { time: series[0].time as Time, value: 0 },
          { time: series[series.length - 1].time as Time, value: 0 },
        ]
      : [];

    for (const [layerId, level] of [
      ['elliott-prob-50', 50],
      ['elliott-prob-70', 70],
    ] as const) {
      layer.line(
        layerId,
        edges.map((point) => ({ ...point, value: level })),
        { color: COLORS.elliottRef, lineWidth: 1, dashed: true, pane: ELLIOTT_PANE }
      );
    }

    const waves: SeriesMarker<Time>[] = [];
    const outcome: SeriesMarker<Time>[] = [];

    if (current) {
      const long = current.direction === 'long';

      for (const [pivot, label] of [
        [current.wave0, '0'],
        [current.wave1, '1'],
        [current.wave2, '2'],
      ] as const) {
        waves.push({
          time: pivot.time as Time,
          position: pivot.type === 'high' ? 'aboveBar' : 'belowBar',
          color: COLORS.elliott,
          shape: 'circle',
          text: label,
        });
      }

      if (current.resolvedTime !== null) {
        const confirmed = current.state === 'confirmed';
        outcome.push({
          time: current.resolvedTime as Time,
          position: long ? 'belowBar' : 'aboveBar',
          color: confirmed ? COLORS.bullish : COLORS.bearish,
          shape: confirmed ? (long ? 'arrowUp' : 'arrowDown') : 'square',
          text: confirmed ? 'ONDA 3 ✓' : 'INVALIDADO ✗',
        });
      }
    }

    layer.markers('elliott-waves', waves);
    layer.markers('elliott-outcome', outcome);
  } else clear('elliottStart');

  // --- Technical (from /technical) ----------------------------------------
  const technical = remote.technical?.ok ? remote.technical.data : null;

  if (on('fibonacci') && technical) {
    const fib = technical.fibonacci ?? {};
    const levels: PriceLineSpec[] = [];

    for (const [label, price] of Object.entries(fib.retracements ?? {})) {
      levels.push({ price, color: COLORS.fib, title: `Fib ${label}`, dashed: true });
    }
    for (const [label, price] of Object.entries(fib.extensions ?? {})) {
      levels.push({ price, color: 'rgba(234,179,8,0.6)', title: `Ext ${label}`, dashed: true });
    }

    layer.priceLines('fib-levels', levels);
  } else clear('fibonacci');

  if (on('zigzag') && technical) {
    layer.line(
      'zigzag',
      dedupe(
        (technical.zigzag ?? []).map((pivot) => ({ time: toChartTime(pivot.date), value: pivot.price }))
      ),
      { color: COLORS.zigzag, lineWidth: 1, title: 'ZigZag' }
    );

    const elliott = technical.elliott;
    const markers: SeriesMarker<Time>[] = [];

    if (elliott?.found && elliott.points) {
      for (const point of elliott.points) {
        const time = snap(point.date);
        if (!time) continue;
        markers.push({
          time,
          position: 'aboveBar',
          color: '#c084fc',
          shape: 'circle',
          text: point.label ?? '',
        });
      }
    }

    layer.markers('elliott', markers);
  } else clear('zigzag');

  if (on('sma') && technical) {
    const flat = (value: number | null, layerId: string, color: string, title: string) => {
      if (value === null || !Number.isFinite(value) || candles.length === 0) {
        layer.remove(layerId);
        return;
      }
      // The API returns only the latest SMA value, so it is drawn as a level
      // across the visible range rather than a curve we do not have.
      layer.line(
        layerId,
        [
          { time: candles[0].time as Time, value },
          { time: candles[candles.length - 1].time as Time, value },
        ],
        { color, lineWidth: 1, title }
      );
    };

    flat(technical.moving_averages?.sma20 ?? null, 'sma20', COLORS.sma20, 'SMA20');
    flat(technical.moving_averages?.sma50 ?? null, 'sma50', COLORS.sma50, 'SMA50');
    flat(technical.moving_averages?.sma200 ?? null, 'sma200', COLORS.sma200, 'SMA200');
  } else clear('sma');
}
