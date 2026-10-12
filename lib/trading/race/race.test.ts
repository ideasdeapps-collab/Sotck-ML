import { describe, expect, it } from 'vitest';
import { RACE_MINUTES, parseTickerList, raceFrames, rankAt, raceScale } from './race';
import type { Bar } from '../aiEcosystem/moves';

const T = Date.UTC(2026, 9, 12, 18, 0);
const MIN = 60_000;

/** Barras de los últimos `n` minutos hasta T, con cierre `price(i)` (i = 0 la más vieja). */
const bars = (n: number, price: (i: number) => number, end = T): Bar[] =>
  Array.from({ length: n }, (_, i) => ({ t: end - (n - 1 - i) * MIN, c: price(i) }));

describe('raceFrames', () => {
  it('seis fotos (de −5 min a ahora) con el % de cada ticker desde la salida', () => {
    const race = raceFrames({ MU: bars(10, (i) => 100 + i), WDC: bars(10, () => 50) });

    expect(race.frames).toEqual([T - 5 * MIN, T - 4 * MIN, T - 3 * MIN, T - 2 * MIN, T - MIN, T]);
    const mu = race.lanes.find((lane) => lane.ticker === 'MU')!;
    expect(mu.path[0]).toBe(0);
    expect(mu.path[5]).toBeCloseTo((109 / 104 - 1) * 100);
    expect(mu.price).toBe(109);
    expect(race.lanes.find((lane) => lane.ticker === 'WDC')!.path).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it('un ticker sin operaciones recientes se queda en su último precio', () => {
    // SNDK no opera desde hace 3 min: sigue en carrera con su último cierre.
    const race = raceFrames({ MU: bars(10, () => 100), SNDK: bars(5, (i) => 200 + i, T - 3 * MIN) });
    const sndk = race.lanes.find((lane) => lane.ticker === 'SNDK')!;
    expect(sndk.path[0]).toBe(0);
    expect(sndk.path[5]).toBeCloseTo((204 / 202 - 1) * 100);
  });

  it('sin barra antes de la salida, ese tramo queda en null', () => {
    const race = raceFrames({ MU: bars(10, () => 100), NEW: bars(2, (i) => 10 + i) });
    expect(race.lanes.find((lane) => lane.ticker === 'NEW')!.path).toEqual([null, null, null, null, null, null]);
  });

  it('sin barras de ningún ticker no hay carrera', () => {
    expect(raceFrames({ MU: [] })).toEqual({ frames: [], lanes: [{ ticker: 'MU', price: null, path: [] }] });
  });

  it('dura RACE_MINUTES', () => {
    expect(RACE_MINUTES).toBe(5);
  });
});

describe('rankAt', () => {
  it('ordena de mayor a menor % en esa foto; los null al final', () => {
    const lanes = [
      { ticker: 'A', price: 1, path: [0, -1] },
      { ticker: 'B', price: 1, path: [0, 2] },
      { ticker: 'C', price: 1, path: [null, null] },
    ];
    expect(rankAt(lanes, 1)).toEqual(['B', 'A', 'C']);
  });
});

describe('raceScale', () => {
  it('el mayor movimiento absoluto de toda la carrera, con un mínimo para no exagerar el ruido', () => {
    expect(raceScale([{ ticker: 'A', price: 1, path: [0, -0.8, 0.5] }])).toBe(0.8);
    expect(raceScale([{ ticker: 'A', price: 1, path: [0, 0.01] }])).toBe(0.1);
  });
});

describe('parseTickerList', () => {
  it('mayúsculas, sin duplicados, solo símbolos válidos y como mucho 12', () => {
    expect(parseTickerList(' mu, skhy  sndk;MU, a/b ,')).toEqual(['MU', 'SKHY', 'SNDK']);
    expect(parseTickerList(Array.from({ length: 20 }, (_, i) => `T${i}`).join(','))).toHaveLength(12);
  });
});
