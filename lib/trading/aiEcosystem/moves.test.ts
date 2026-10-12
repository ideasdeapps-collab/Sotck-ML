import { describe, expect, it } from 'vitest';
import { linkAverage, moveColor, parseMinuteAggs, summarizeBars, type Bar } from './moves';
import { etWallClockToEpoch } from '../chartTime';

const at = (day: number, hour: number, minute: number) => etWallClockToEpoch(2026, 10, day, hour, minute) * 1000;

/** Barras de 1 min de `from` a `to` (ET, mismo día), con cierre `price(i)`. */
function session(day: number, from: [number, number], to: [number, number], price: (i: number) => number): Bar[] {
  const bars: Bar[] = [];
  for (let t = at(day, ...from), i = 0; t <= at(day, ...to); t += 60_000, i++) bars.push({ t, c: price(i) });
  return bars;
}

describe('summarizeBars', () => {
  // Viernes 9: sesión regular que cierra en 100, y after-hours en 101.
  const friday = [...session(9, [15, 0], [15, 59], () => 100), ...session(9, [16, 0], [17, 0], () => 101)];
  // Lunes 12, premarket: de 102 subiendo 0.1 por minuto.
  const monday = session(12, [8, 0], [8, 30], (i) => 102 + i * 0.1);

  it('cambio del día contra el cierre regular anterior, no contra el after-hours', () => {
    const move = summarizeBars([...friday, ...monday])!;
    expect(move.prevClose).toBe(100);
    expect(move.price).toBeCloseTo(105);
    expect(move.change1d).toBeCloseTo(5);
    expect(move.time).toBe(at(12, 8, 30));
  });

  it('cambio a 5 y 15 min contra la barra de hace 5 y 15 min', () => {
    const move = summarizeBars([...friday, ...monday])!;
    expect(move.change5m).toBeCloseTo((105 / 104.5 - 1) * 100);
    expect(move.change15m).toBeCloseTo((105 / 103.5 - 1) * 100);
  });

  it('la minilínea es solo de la última sesión y como mucho 60 puntos, terminando en el último precio', () => {
    const long = session(12, [4, 0], [11, 0], (i) => 100 + i);
    const move = summarizeBars([...friday, ...long])!;
    expect(move.sparkline.length).toBeLessThanOrEqual(61);
    expect(move.sparkline[0]).toBe(100);
    expect(move.sparkline[move.sparkline.length - 1]).toBe(long[long.length - 1].c);
  });

  it('sin historia suficiente, los cambios son null; sin barras, null', () => {
    const move = summarizeBars(session(12, [8, 0], [8, 3], () => 50))!;
    expect(move.prevClose).toBeNull();
    expect(move.change1d).toBeNull();
    expect(move.change5m).toBeNull();
    expect(summarizeBars([])).toBeNull();
  });

  it('el orden de entrada no importa (Polygon se pide en orden descendente)', () => {
    const bars = [...friday, ...monday];
    expect(summarizeBars([...bars].reverse())).toEqual(summarizeBars(bars));
  });
});

describe('parseMinuteAggs', () => {
  it('lee t y c de `results`; null si no hay resultados', () => {
    expect(parseMinuteAggs({ results: [{ t: 1, c: 2, o: 1 }, { t: 2 }] })).toEqual([{ t: 1, c: 2 }]);
    expect(parseMinuteAggs({ status: 'ERROR' })).toBeNull();
    expect(parseMinuteAggs({ results: [] })).toBeNull();
  });
});

describe('linkAverage', () => {
  it('media de los tickers con dato; null si ninguno lo tiene', () => {
    expect(linkAverage([2, null, -1])).toBeCloseTo(0.5);
    expect(linkAverage([null, null])).toBeNull();
  });
});

describe('moveColor', () => {
  it('verde al subir, rojo al bajar, más intenso cuanto mayor el movimiento y saturado en la escala', () => {
    expect(moveColor(1.5, 3)).toBe('rgba(34, 197, 94, 0.5)');
    expect(moveColor(-9, 3)).toBe('rgba(239, 68, 68, 0.85)');
    expect(moveColor(0, 3)).toBe('rgba(148, 163, 184, 0.15)');
    expect(moveColor(null, 3)).toBe('rgba(148, 163, 184, 0.08)');
  });
});
