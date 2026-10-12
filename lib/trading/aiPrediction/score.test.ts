import { describe, expect, it } from 'vitest';
import { scorePrediction } from './score';

const MIN = 60_000;
const T0 = Date.UTC(2026, 9, 12, 14, 0);

/** Barras de 1 min desde T0 con cierre `price(i)`. */
const bars = (n: number, price: (i: number) => number) => Array.from({ length: n }, (_, i) => ({ t: T0 + i * MIN, c: price(i) }));

describe('scorePrediction', () => {
  it('compara cada punto con el cierre de la barra que termina a esa hora', () => {
    // Real: 100 + i. A las T0+5 min el precio real es el cierre de la barra 4 (104).
    const points = [
      { t: T0 + 5 * MIN, p: 105 },
      { t: T0 + 10 * MIN, p: 109 },
    ];
    const score = scorePrediction(points, 100, bars(10, (i) => 100 + i));

    expect(score.evaluated).toBe(2);
    expect(score.complete).toBe(true);
    expect(score.maePct).toBeCloseTo(((1 / 104) * 100 + 0) / 2, 3);
    expect(score.endErrorPct).toBe(0);
    expect(score.directionHit).toBe(true);
  });

  it('los puntos futuros no cuentan y la dirección se juzga con el último evaluado', () => {
    const points = [
      { t: T0 + 5 * MIN, p: 101 },
      { t: T0 + 60 * MIN, p: 110 },
    ];
    const score = scorePrediction(points, 100, bars(10, () => 98));

    expect(score.evaluated).toBe(1);
    expect(score.complete).toBe(false);
    expect(score.directionHit).toBe(false);
  });

  it('sin barras no evalúa nada', () => {
    expect(scorePrediction([{ t: T0, p: 1 }], 1, []).evaluated).toBe(0);
  });
});
