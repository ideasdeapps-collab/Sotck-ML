import { describe, expect, it } from 'vitest';
import { signalRays } from './signal1mRays';
import type { OneMinuteSignal, OneMinuteSignalHorizon } from '@/types/trading';

const horizon = (over: Partial<OneMinuteSignalHorizon>): OneMinuteSignalHorizon => ({
  h: 5, p_up: 0.58, direction: 'up', confident: true, available: true, tau: 0.05,
  oos_precision: 0.56, coverage: 0.24, has_edge: true, path_close: 100.1, dead_band: 0.0004,
  ...over,
});

const signal = (horizons: OneMinuteSignalHorizon[]): OneMinuteSignal => ({
  ticker: 'NVDA', as_of: '2026-09-22T10:42:00-04:00', last_close: 100, sigma_1m: 0.0008,
  momentum_up: true, horizons, model_trained_at: null, generated_at: '', note: '',
});

// 2026-09-22 10:42 ET = 14:42 UTC
const AS_OF = Date.UTC(2026, 8, 22, 14, 42) / 1000;

describe('signalRays', () => {
  it('traza un rayo por horizonte desde la última barra hasta as_of + h', () => {
    const rays = signalRays(signal([horizon({}), horizon({ h: 15, path_close: 99.8, direction: 'down', p_up: 0.4 })]), (t) => t);

    expect(rays.map((r) => r.h)).toEqual([5, 15]);
    expect(rays[0].points).toEqual([
      { time: AS_OF, value: 100 },
      { time: AS_OF + 5 * 60, value: 100.1 },
    ]);
    expect(rays[1].points[1]).toEqual({ time: AS_OF + 15 * 60, value: 99.8 });
    expect(rays[0].direction).toBe('up');
    expect(rays[1].direction).toBe('down');
  });

  it('omite los horizontes que no caben antes del cierre', () => {
    const rays = signalRays(signal([horizon({}), horizon({ h: 30, available: false })]), (t) => t);
    expect(rays.map((r) => r.h)).toEqual([5]);
  });

  it('solo marca como firme el horizonte confiado y con ventaja demostrada', () => {
    const rays = signalRays(
      signal([
        horizon({ h: 5 }),
        horizon({ h: 15, confident: false }),
        horizon({ h: 30, has_edge: false }),
      ]),
      (t) => t
    );
    expect(rays.map((r) => r.firm)).toEqual([true, false, false]);
  });

  it('ancla el arranque a la vela que contiene as_of (gráfico de 5m)', () => {
    const barStart = AS_OF - 2 * 60;
    const rays = signalRays(signal([horizon({})]), () => barStart);
    expect(rays[0].points[0].time).toBe(barStart);
    expect(rays[0].points[1].time).toBe(AS_OF + 5 * 60);
  });

  it('sin as_of legible no dibuja nada', () => {
    const bad = { ...signal([horizon({})]), as_of: 'no-es-fecha' };
    expect(signalRays(bad, (t) => t)).toEqual([]);
  });
});
