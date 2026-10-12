import { describe, expect, it } from 'vitest';
import { predictionSlots } from './chart';

describe('predictionSlots', () => {
  const candles = [0, 300, 600]; // velas de 5 min, en segundos

  it('dentro del rango se lleva a sus velas; por delante deja una ranura por barra', () => {
    const slots = predictionSlots(
      [
        { time: 600, value: 10 },
        { time: 1200, value: 12 },
        { time: 1800, value: 11 },
      ],
      candles,
      '5m'
    );

    expect(slots).toEqual([
      { time: 600, value: 10 },
      { time: 900 },
      { time: 1200, value: 12 },
      { time: 1500 },
      { time: 1800, value: 11 },
    ]);
  });

  it('en 15 min agrupa los puntos por barra y se queda con el último', () => {
    const slots = predictionSlots(
      [
        { time: 900, value: 1 },
        { time: 1200, value: 2 },
        { time: 1800, value: 3 },
      ],
      [0],
      '15m'
    );
    expect(slots).toEqual([{ time: 900, value: 2 }, { time: 1800, value: 3 }]);
  });

  it('en diario no se dibuja', () => {
    expect(predictionSlots([{ time: 900, value: 1 }], candles, '1d')).toEqual([]);
  });
});
