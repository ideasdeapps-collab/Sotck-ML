import { describe, expect, it } from 'vitest';
import { bestOutcomePerPeak, buildSignalCallouts, type RawAlert } from './alerts';
import type { Candle } from '../marketData';

/**
 * Velas de un minuto empezando en epoch 1000, con máximos y mínimos elegidos a
 * mano para que el recorrido posterior sea comprobable a ojo.
 */
const candles: Candle[] = [
  { time: 1000, open: 10, high: 11, low: 9, close: 10, volume: 1 },
  { time: 1060, open: 10, high: 12, low: 10, close: 11, volume: 1 },
  { time: 1120, open: 11, high: 15, low: 10, close: 12, volume: 1 },
  { time: 1180, open: 12, high: 20, low: 8, close: 13, volume: 1 },
  { time: 1240, open: 13, high: 14, low: 12, close: 13, volume: 1 },
];

const alert = (overrides: Partial<RawAlert> = {}): RawAlert => ({
  time: 1060,
  direction: 'COMPRA',
  strength: 'ALTA',
  aligned_with_daily: true,
  trigger: 'breakout alcista',
  level: 10.5,
  price: 10,
  reasons: ['Predicción diaria alcista'],
  ...overrides,
});

describe('anclaje a la vela', () => {
  it('ancla a la vela que contiene la alerta, no a la siguiente', () => {
    // 1100 cae dentro de la vela que abre en 1060.
    const [callout] = buildSignalCallouts([alert({ time: 1100 })], candles);
    expect(callout.time).toBe(1060);
    expect(callout.index).toBe(1);
  });

  it('acepta una marca de tiempo ISO con desfase horario', () => {
    const iso = new Date(1120 * 1000).toISOString();
    expect(buildSignalCallouts([alert({ time: iso })], candles)[0].time).toBe(1120);
  });

  it('descarta una alerta anterior a la primera vela cargada', () => {
    expect(buildSignalCallouts([alert({ time: 500 })], candles)).toEqual([]);
  });

  it('descarta una marca de tiempo ilegible en vez de romper', () => {
    expect(buildSignalCallouts([alert({ time: 'no es una fecha' })], candles)).toEqual([]);
  });
});

describe('dirección', () => {
  it('traduce COMPRA y VENTA', () => {
    expect(buildSignalCallouts([alert()], candles)[0].direction).toBe('buy');
    expect(buildSignalCallouts([alert({ direction: 'VENTA' })], candles)[0].direction).toBe('sell');
  });

  it('etiqueta la señal como en el gráfico de referencia', () => {
    expect(buildSignalCallouts([alert()], candles)[0].label).toBe('BUY SIGNAL');
    expect(buildSignalCallouts([alert({ direction: 'VENTA' })], candles)[0].label).toBe('SELL SIGNAL');
  });
});

describe('recorrido posterior', () => {
  it('mide una compra contra el máximo posterior', () => {
    // Señal en la vela 1060 a 10; el máximo posterior es 20, en 1180.
    const [callout] = buildSignalCallouts([alert({ time: 1060, price: 10 })], candles);
    expect(callout.followThrough).toBe(100);
    expect(callout.peakPrice).toBe(20);
    expect(callout.peakTime).toBe(1180);
  });

  it('mide una venta contra el mínimo posterior, y una caída es positiva', () => {
    const [callout] = buildSignalCallouts(
      [alert({ time: 1060, price: 10, direction: 'VENTA' })],
      candles
    );
    // Mínimo posterior 8: la venta ganó un 20%.
    expect(callout.followThrough).toBe(20);
    expect(callout.peakPrice).toBe(8);
  });

  it('no inventa recorrido cuando la señal cae en la última vela', () => {
    const [callout] = buildSignalCallouts([alert({ time: 1240 })], candles);
    expect(callout.followThrough).toBeNull();
    expect(callout.peakTime).toBeNull();
  });

  it('excluye la propia vela de la señal del recorrido', () => {
    // La vela 1180 tiene el máximo de 20; una señal ahí solo puede mirar a 1240.
    const [callout] = buildSignalCallouts([alert({ time: 1180, price: 10 })], candles);
    expect(callout.peakPrice).toBe(14);
  });
});

describe('orden y límite', () => {
  it('prioriza las alineadas con el sesgo diario y se queda con las más recientes', () => {
    const alerts = [
      alert({ time: 1000, aligned_with_daily: false, level: 1 }),
      alert({ time: 1060, aligned_with_daily: false, level: 2 }),
      alert({ time: 1120, aligned_with_daily: true, level: 3 }),
      alert({ time: 1180, aligned_with_daily: true, level: 4 }),
    ];

    const callouts = buildSignalCallouts(alerts, candles, 2);

    expect(callouts.map((c) => c.level)).toEqual([3, 4]);
  });

  it('devuelve las señales en orden cronológico, para dibujarlas', () => {
    const alerts = [alert({ time: 1180, level: 9 }), alert({ time: 1060, level: 1 })];
    expect(buildSignalCallouts(alerts, candles).map((c) => c.time)).toEqual([1060, 1180]);
  });

  it('colapsa dos alertas que caen en la misma vela', () => {
    const alerts = [alert({ time: 1060, level: 1 }), alert({ time: 1100, level: 2 })];
    expect(buildSignalCallouts(alerts, candles)).toHaveLength(1);
  });
});

describe('sin datos', () => {
  it('no devuelve nada sin velas', () => {
    expect(buildSignalCallouts([alert()], [])).toEqual([]);
  });

  it('no devuelve nada sin alertas', () => {
    expect(buildSignalCallouts([], candles)).toEqual([]);
  });
});

describe('bestOutcomePerPeak', () => {
  it('deja una sola etiqueta cuando dos señales acaban en el mismo máximo', () => {
    // Ambas compras desembocan en el máximo de 20 de la vela 1180.
    const callouts = buildSignalCallouts(
      [alert({ time: 1000, price: 10 }), alert({ time: 1120, price: 12 })],
      candles
    );
    expect(callouts).toHaveLength(2);

    const outcomes = bestOutcomePerPeak(callouts);
    expect(outcomes).toHaveLength(1);
    // Gana la de mayor recorrido: desde 10 hasta 20 son +100%.
    expect(outcomes[0].followThrough).toBe(100);
  });

  it('conserva picos distintos', () => {
    const callouts = buildSignalCallouts(
      [alert({ time: 1000, price: 10 }), alert({ time: 1180, price: 13 })],
      candles
    );
    expect(bestOutcomePerPeak(callouts)).toHaveLength(2);
  });

  it('descarta las señales sin recorrido', () => {
    expect(bestOutcomePerPeak(buildSignalCallouts([alert({ time: 1240 })], candles))).toEqual([]);
  });
});
