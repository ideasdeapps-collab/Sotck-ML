import { describe, expect, it } from 'vitest';
import { signalLegend } from './signal1mLegend';
import type { OneMinuteSignalBundle, OneMinuteSignalHorizon } from '@/types/trading';

const horizon = (over: Partial<OneMinuteSignalHorizon>): OneMinuteSignalHorizon => ({
  h: 5, p_up: 0.58, direction: 'up', confident: true, available: true, tau: 0.05,
  oos_precision: 0.56, coverage: 0.24, has_edge: true, path_close: 100.1, dead_band: 0.0004,
  ...over,
});

const bundle = (horizons: OneMinuteSignalHorizon[], score: OneMinuteSignalBundle['score'] = null): OneMinuteSignalBundle => ({
  signal: {
    ticker: 'NVDA', as_of: '2026-09-22T10:42:00-04:00', last_close: 100, sigma_1m: 0.0008,
    momentum_up: true, horizons, model_trained_at: null, generated_at: '', note: '',
  },
  score,
});

describe('signalLegend', () => {
  it('muestra hora ET, dirección, probabilidad y lectura por horizonte', () => {
    const text = signalLegend(bundle([
      horizon({}),
      horizon({ h: 15, p_up: 0.46, direction: 'down', confident: false }),
      horizon({ h: 30, available: false, confident: false }),
    ]));
    expect(text).toContain('10:42 ET');
    expect(text).toContain('5m ↑ 58% (confiado · 56% fuera de muestra)');
    expect(text).toContain('15m ↓ 54% (se abstiene)');
    expect(text).toContain('30m — fuera de sesión');
    expect(text).toContain('~15 min de retraso');
  });

  it('sin ventaja demostrada lo dice aunque esté confiado', () => {
    const text = signalLegend(bundle([horizon({ has_edge: false })]));
    expect(text).toContain('sin ventaja demostrada');
    expect(text).not.toContain('confiado ·');
  });

  it('resume el acierto en vivo o avisa de que no lo hay', () => {
    expect(signalLegend(bundle([horizon({})]))).toContain('sin histórico en vivo');
    const score = {
      n_signals: 10,
      horizons: { '5': { resolved: 120, pending: 2, flat_share: 0.3, acc_all: 0.52, acc_confident: 0.57, coverage: 0.25, acc_momentum: 0.5 } },
    };
    expect(signalLegend(bundle([horizon({})], score))).toContain('en vivo 5m: 57% confiado · 52% total (n=120)');
  });
});
