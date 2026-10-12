import { describe, expect, it } from 'vitest';
import { buildBrief } from './brief';
import { sessionWindow } from './session';
import type { AiPrediction } from './types';

// Lunes 12-oct-2026, 11:00 ET.
const NOW = Date.UTC(2026, 9, 12, 15, 0);
const AS_OF = Date.UTC(2026, 9, 12, 14, 45);

const past: AiPrediction = {
  id: 'a',
  ticker: 'MU',
  createdAt: '2026-10-09T15:00:00Z',
  asOf: Date.UTC(2026, 9, 9, 14, 45),
  anchor: 100,
  sessionDate: '2026-10-09',
  model: 'deepseek-chat',
  bias: 'alcista',
  confidence: 70,
  reasoning: 'Sube',
  keyLevels: [],
  points: [{ t: Date.UTC(2026, 9, 9, 20, 0), p: 104 }],
  score: { evaluated: 1, total: 1, maePct: 2, endErrorPct: 2, directionHit: false, complete: true, checkpoints: [] },
  sources: [],
  failures: [],
};

describe('buildBrief', () => {
  it('lleva las horas objetivo, el ancla y el resumen del historial', () => {
    const window = sessionWindow(NOW, AS_OF);
    if (typeof window === 'string') throw new Error(window);

    const brief = buildBrief({
      ticker: 'MU',
      now: NOW,
      asOf: AS_OF,
      anchor: 120,
      window,
      candles5m: null,
      live: { price: 121, time: NOW / 1000, source: 'yahoo' },
      news: null,
      ecosystem: null,
      ml: { senal_1m: { p_up: 0.61234567 } },
      history: [past],
    });

    expect(brief.n_puntos).toBe(window.targets.length);
    expect(brief.horas_objetivo[0]).toBe('10:50');
    expect(brief.ultima_vela.precio).toBe(120);
    expect(brief.precio_web_tiempo_real).toEqual({ precio: 121, hora_et: '11:00', fuente: 'yahoo' });
    expect(brief.modelos_ml).toEqual({ senal_1m: { p_up: 0.612346 } });
    expect(brief.historial.resumen).toEqual({
      predicciones_evaluadas: 1,
      error_medio_pct: 2,
      sesgo_medio_final_pct: 2,
      acierto_direccion_pct: 0,
    });
  });
});
