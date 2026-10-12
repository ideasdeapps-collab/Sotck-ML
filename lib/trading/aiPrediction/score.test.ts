import { describe, expect, it } from 'vitest';
import { scorePrediction, summarizeHorizons } from './score';

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

describe('horizontes frente a las predicciones ingenuas', () => {
  // Real: sube 0.1 por minuto desde 100 durante 3 h a partir de T0.
  const real = bars(180, (i) => 100 + i * 0.1);
  const asOf = T0 + 60 * MIN; // ancla: cierre de la barra 59 = 105.9
  const anchor = 105.9;

  it('mide 30 min, 60 min y el cierre contra plano y momentum', () => {
    const points = [30, 60, 90].map((m) => ({ t: asOf + m * MIN, p: anchor + m * 0.1 }));
    const score = scorePrediction(points, anchor, real, asOf);
    const [h30, h60, close] = score.horizons!;

    expect(score.horizons!.map((h) => h.label)).toEqual(['30 min', '60 min', 'cierre']);
    expect(h30.errorPct).toBe(0);
    expect(h30.flatErrorPct).toBeGreaterThan(2.5);
    // Momentum de 30 min (+3 por cada 30 min) casi acierta a 60 min (el % se mide desde una base menor) y luego se queda plano.
    expect(h60.momentumErrorPct).toBeLessThan(0.2);
    expect(close.momentumErrorPct).toBeGreaterThan(2);
    expect(h30.directionHit && h30.momentumHit).toBe(true);
    expect(score.flatMaePct).toBeGreaterThan(score.maePct!);
  });

  it('no evalúa un horizonte que aún no llegó', () => {
    const points = [30, 60, 90].map((m) => ({ t: asOf + m * MIN, p: anchor }));
    const score = scorePrediction(points, anchor, real.slice(0, 100), asOf);
    expect(score.horizons!.map((h) => h.label)).toEqual(['30 min']);
  });
});

describe('summarizeHorizons', () => {
  it('promedia errores y aciertos por horizonte', () => {
    const row = (errorPct: number, hit: boolean) => ({
      label: '30 min' as const,
      t: 0,
      predictedPct: 0,
      actualPct: 0,
      errorPct,
      flatErrorPct: 1,
      momentumErrorPct: null,
      directionHit: hit,
      momentumHit: null,
    });
    const score = (h: ReturnType<typeof row>) => ({ ...scorePrediction([], 1, []), horizons: [h] });

    expect(summarizeHorizons([score(row(0.5, true)), score(row(1.5, false)), null])).toEqual([
      { label: '30 min', n: 2, ai: 1, flat: 1, momentum: null, aiHits: 50, momentumHits: null },
    ]);
  });
});
