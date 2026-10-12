import { describe, expect, it } from 'vitest';
import { appendQuote, barStart, liveLegend, trailPoints, trailSlots, type LiveQuote } from './liveTrail';
import { dailyDateToEpoch } from '../chartTime';

const quote = (time: number, price: number): LiveQuote => ({ time, price, source: 'yahoo' });

// 2026-10-12 14:03:12 ET (EDT, UTC-4)
const T = Date.UTC(2026, 9, 12, 18, 3, 12) / 1000;

describe('barStart', () => {
  it('lleva el instante al inicio de su barra intradía', () => {
    expect(barStart(T, '1m')).toBe(Date.UTC(2026, 9, 12, 18, 3) / 1000);
    expect(barStart(T, '5m')).toBe(Date.UTC(2026, 9, 12, 18, 0) / 1000);
    expect(barStart(T, '15m')).toBe(Date.UTC(2026, 9, 12, 18, 0) / 1000);
    expect(barStart(T, '1h')).toBe(Date.UTC(2026, 9, 12, 18, 0) / 1000);
  });

  it('en diario ancla a la medianoche ET, como las velas de Polygon', () => {
    expect(barStart(T, '1d')).toBe(dailyDateToEpoch('2026-10-12'));
    // 23:30 ET sigue siendo el mismo día ET aunque en UTC ya sea el siguiente.
    expect(barStart(Date.UTC(2026, 9, 13, 3, 30) / 1000, '1d')).toBe(dailyDateToEpoch('2026-10-12'));
  });
});

describe('appendQuote', () => {
  it('añade en orden y no repite la misma cotización', () => {
    const trail = appendQuote(appendQuote([], quote(T, 100)), quote(T, 100));
    expect(trail).toHaveLength(1);
    expect(appendQuote(trail, quote(T + 15, 101)).map((q) => q.price)).toEqual([100, 101]);
  });

  it('descarta las cotizaciones más viejas al pasar el tope', () => {
    let trail: LiveQuote[] = [];
    for (let i = 0; i < 5; i++) trail = appendQuote(trail, quote(T + i, i), 3);
    expect(trail.map((q) => q.price)).toEqual([2, 3, 4]);
  });

  it('una cotización anterior a la última no se cuela al final', () => {
    const trail = appendQuote([quote(T, 100)], quote(T - 60, 99));
    expect(trail.map((q) => q.time)).toEqual([T - 60, T]);
  });
});

describe('trailPoints', () => {
  it('un punto por barra, con el último precio de esa barra', () => {
    const points = trailPoints([quote(T, 100), quote(T + 15, 101), quote(T + 60, 102)], '1m');
    expect(points).toEqual([
      { time: barStart(T, '1m'), value: 101 },
      { time: barStart(T + 60, '1m'), value: 102 },
    ]);
  });

  it('sin cotizaciones no hay puntos', () => {
    expect(trailPoints([], '5m')).toEqual([]);
  });
});

describe('liveLegend', () => {
  it('precio, hora ET, fuente y desvío frente a la última vela', () => {
    const text = liveLegend(quote(T, 189.42), 188.84);
    expect(text).toContain('$189.42');
    expect(text).toContain('14:03:12 ET');
    expect(text).toContain('Yahoo');
    expect(text).toContain('+0.31% vs última vela Polygon');
  });

  it('sin vela de referencia omite el desvío', () => {
    expect(liveLegend(quote(T, 50), null)).not.toContain('vs última vela');
  });
});

describe('trailSlots', () => {
  const lastCandle = barStart(T, '1m') - 15 * 60;

  it('rellena con ranuras vacías el hueco entre la última vela y el precio web', () => {
    const slots = trailSlots([{ time: barStart(T, '1m'), value: 101 }], lastCandle, '1m');
    expect(slots).toHaveLength(15);
    expect(slots[0]).toEqual({ time: lastCandle + 60 });
    expect(slots[13]).toEqual({ time: lastCandle + 14 * 60 });
    expect(slots[14]).toEqual({ time: barStart(T, '1m'), value: 101 });
  });

  it('también rellena los huecos entre puntos del rastro', () => {
    const start = lastCandle + 60;
    const slots = trailSlots([{ time: start, value: 1 }, { time: start + 180, value: 2 }], lastCandle, '1m');
    expect(slots.map((slot) => ('value' in slot ? slot.value : null))).toEqual([1, null, null, 2]);
  });

  it('no rellena antes de la última vela: ahí las ranuras ya las ponen las velas', () => {
    const slots = trailSlots([{ time: lastCandle - 120, value: 1 }], lastCandle, '1m');
    expect(slots).toEqual([{ time: lastCandle - 120, value: 1 }]);
  });

  it('un hueco desmedido (fin de semana) no se rellena', () => {
    const slots = trailSlots([{ time: lastCandle + 3 * 86400, value: 1 }], lastCandle, '1m');
    expect(slots).toEqual([{ time: lastCandle + 3 * 86400, value: 1 }]);
  });

  it('en diario no hay nada que rellenar', () => {
    const day = barStart(T, '1d');
    expect(trailSlots([{ time: day, value: 1 }], day, '1d')).toEqual([{ time: day, value: 1 }]);
  });
});
