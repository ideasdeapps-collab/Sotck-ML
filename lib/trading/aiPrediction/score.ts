import type { Bar } from '../aiEcosystem/moves';
import type { PredictionPoint, PredictionScore } from './types';

/**
 * Compara una predicción con lo que de verdad pasó, con barras de 1 min.
 *
 * El precio real «a las 10:35» es el cierre de la barra de 10:34 (la que
 * termina a las 10:35). Un punto cuya hora aún no llegó (o que cae más allá de
 * las barras disponibles) no se evalúa.
 */

const MINUTE = 60_000;
/** Por debajo de esto, un movimiento es «plano» al juzgar la dirección. */
const FLAT_PCT = 0.05;
const CHECKPOINT_EVERY = 12; // 12 × 5 min = una hora

const direction = (from: number, to: number) => {
  const move = ((to - from) / from) * 100;
  return Math.abs(move) < FLAT_PCT ? 0 : Math.sign(move);
};

export function scorePrediction(points: PredictionPoint[], anchor: number, input: Bar[]): PredictionScore {
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

  if (pairs.length === 0) {
    return { evaluated: 0, total: points.length, maePct: null, endErrorPct: null, directionHit: null, complete: false, checkpoints: [] };
  }

  const errors = pairs.map((pair) => (Math.abs(pair.predicted - pair.actual) / pair.actual) * 100);
  const last = pairs[pairs.length - 1];
  const round = (value: number) => Number(value.toFixed(3));

  return {
    evaluated: pairs.length,
    total: points.length,
    maePct: round(errors.reduce((sum, error) => sum + error, 0) / errors.length),
    endErrorPct: round(((last.predicted - last.actual) / last.actual) * 100),
    directionHit: direction(anchor, last.predicted) === direction(anchor, last.actual),
    complete: pairs.length === points.length,
    checkpoints: pairs.filter((_, i) => (i + 1) % CHECKPOINT_EVERY === 0 || i === pairs.length - 1),
  };
}
