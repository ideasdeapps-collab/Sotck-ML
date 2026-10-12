import type { Bar } from '../aiEcosystem/moves';
import type { HorizonResult, PredictionPoint, PredictionScore } from './types';

/**
 * Compara una predicción con lo que de verdad pasó, con barras de 1 min.
 *
 * El precio real «a las 10:35» es el cierre de la barra de 10:34 (la que
 * termina a las 10:35). Un punto cuya hora aún no llegó (o que cae más allá de
 * las barras disponibles) no se evalúa.
 *
 * Además del error del camino completo, mide tres horizontes fijos (30 min,
 * 60 min y el cierre) frente a dos predicciones ingenuas: plano y momentum.
 */

const MINUTE = 60_000;
/** Por debajo de esto, un movimiento es «plano» al juzgar la dirección. */
export const FLAT_PCT = 0.05;
const CHECKPOINT_EVERY = 12; // 12 × 5 min = una hora
const MOMENTUM_LOOKBACK_MS = 30 * MINUTE;
const MOMENTUM_CAP_MS = 60 * MINUTE;

const HORIZONS: { label: HorizonResult['label']; ms: number | null }[] = [
  { label: '30 min', ms: 30 * MINUTE },
  { label: '60 min', ms: 60 * MINUTE },
  { label: 'cierre', ms: null },
];

const pctMove = (from: number, to: number) => ((to - from) / from) * 100;
const direction = (from: number, to: number) => {
  const move = pctMove(from, to);
  return Math.abs(move) < FLAT_PCT ? 0 : Math.sign(move);
};
const errorPct = (predicted: number, actual: number) => (Math.abs(predicted - actual) / actual) * 100;
const round = (value: number) => Number(value.toFixed(3));

/** Cierre real «a la hora t»: el de la última barra que termina a esa hora o antes. */
function actualAt(bars: Bar[], t: number): number | null {
  let close: number | null = null;
  for (const bar of bars) {
    if (bar.t + MINUTE > t) break;
    close = bar.c;
  }
  return close;
}

function horizonResults(points: PredictionPoint[], anchor: number, asOf: number, bars: Bar[], lastClose: number): HorizonResult[] {
  if (points.length === 0) return [];

  // Momentum: el % de los 30 min previos al ancla, por milisegundo.
  const before = actualAt(bars, asOf - MOMENTUM_LOOKBACK_MS);
  const ratePerMs = before ? pctMove(before, anchor) / MOMENTUM_LOOKBACK_MS : null;

  const results: HorizonResult[] = [];
  for (const horizon of HORIZONS) {
    const point =
      horizon.ms === null ? points[points.length - 1] : points.find((candidate) => candidate.t >= asOf + horizon.ms!);
    // Sin punto es que el horizonte cae después del cierre: ya lo cubre «cierre».
    if (!point || point.t > lastClose) continue;

    const actual = actualAt(bars, point.t);
    if (actual === null) continue;

    const momentumPrice =
      ratePerMs === null ? null : anchor * (1 + (ratePerMs * Math.min(point.t - asOf, MOMENTUM_CAP_MS)) / 100);

    results.push({
      label: horizon.label,
      t: point.t,
      predictedPct: round(pctMove(anchor, point.p)),
      actualPct: round(pctMove(anchor, actual)),
      errorPct: round(errorPct(point.p, actual)),
      flatErrorPct: round(errorPct(anchor, actual)),
      momentumErrorPct: momentumPrice === null ? null : round(errorPct(momentumPrice, actual)),
      directionHit: direction(anchor, point.p) === direction(anchor, actual),
      momentumHit: momentumPrice === null ? null : direction(anchor, momentumPrice) === direction(anchor, actual),
    });
  }
  return results;
}

/** `asOf`: hora del ancla (epoch ms); la usan los horizontes y el momentum. */
export function scorePrediction(points: PredictionPoint[], anchor: number, input: Bar[], asOf?: number): PredictionScore {
  const bars = [...input].sort((a, b) => a.t - b.t);
  const lastClose = bars.length > 0 ? bars[bars.length - 1].t + MINUTE : -Infinity;

  const pairs: { t: number; predicted: number; actual: number }[] = [];
  let cursor = -1;

  for (const point of points) {
    if (point.t > lastClose) break;
    while (cursor + 1 < bars.length && bars[cursor + 1].t + MINUTE <= point.t) cursor++;
    if (cursor < 0) continue;
    pairs.push({ t: point.t, predicted: point.p, actual: bars[cursor].c });
  }

  const horizons = asOf === undefined ? [] : horizonResults(points, anchor, asOf, bars, lastClose);

  if (pairs.length === 0) {
    return {
      evaluated: 0,
      total: points.length,
      maePct: null,
      endErrorPct: null,
      directionHit: null,
      flatMaePct: null,
      horizons,
      complete: false,
      checkpoints: [],
    };
  }

  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  const last = pairs[pairs.length - 1];

  return {
    evaluated: pairs.length,
    total: points.length,
    maePct: round(mean(pairs.map((pair) => errorPct(pair.predicted, pair.actual)))),
    endErrorPct: round(((last.predicted - last.actual) / last.actual) * 100),
    directionHit: direction(anchor, last.predicted) === direction(anchor, last.actual),
    flatMaePct: round(mean(pairs.map((pair) => errorPct(anchor, pair.actual)))),
    horizons,
    complete: pairs.length === points.length,
    checkpoints: pairs.filter((_, i) => (i + 1) % CHECKPOINT_EVERY === 0 || i === pairs.length - 1),
  };
}

export type HorizonSummary = {
  label: HorizonResult['label'];
  n: number;
  /** Errores medios, en %. */
  ai: number;
  flat: number;
  momentum: number | null;
  /** Aciertos de dirección, en %. */
  aiHits: number;
  momentumHits: number | null;
};

/** Medias por horizonte sobre varias predicciones: ¿gana la IA a las ingenuas? */
export function summarizeHorizons(scores: (PredictionScore | null)[]): HorizonSummary[] {
  return HORIZONS.flatMap(({ label }) => {
    const rows = scores.flatMap((score) => score?.horizons?.filter((item) => item.label === label) ?? []);
    if (rows.length === 0) return [];

    const mean = (values: number[]) => round(values.reduce((sum, value) => sum + value, 0) / values.length);
    const withMomentum = rows.filter((row) => row.momentumErrorPct !== null);

    return [
      {
        label,
        n: rows.length,
        ai: mean(rows.map((row) => row.errorPct)),
        flat: mean(rows.map((row) => row.flatErrorPct)),
        momentum: withMomentum.length ? mean(withMomentum.map((row) => row.momentumErrorPct!)) : null,
        aiHits: Math.round((rows.filter((row) => row.directionHit).length / rows.length) * 100),
        momentumHits: withMomentum.length
          ? Math.round((withMomentum.filter((row) => row.momentumHit).length / withMomentum.length) * 100)
          : null,
      },
    ];
  });
}
