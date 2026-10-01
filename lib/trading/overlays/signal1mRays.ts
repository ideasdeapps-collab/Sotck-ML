import { toChartTime } from '../chartTime';
import type { OneMinuteSignal } from '@/types/trading';

/**
 * Trazo en el gráfico de la señal de dirección de 1 min.
 *
 * Un rayo por horizonte (5/15/30 min) desde la última barra real hasta
 * `as_of + h`, a la altura de `path_close`. Es un trazo indicativo, no un
 * precio objetivo: lo que importa es hacia dónde apunta y si es firme. Solo
 * se dibuja firme el horizonte confiado Y con ventaja demostrada fuera de
 * muestra; el resto va punteado para que no se lea como certeza.
 */

export type SignalRay = {
  h: number;
  direction: 'up' | 'down';
  firm: boolean;
  points: { time: number; value: number }[];
};

/**
 * `anchor` lleva `as_of` (epoch s) a la vela que lo contiene en el gráfico
 * actual: en 5m la barra de 1 min cae dentro de una vela, y una serie que
 * arranca fuera de la escala de tiempo queda flotando.
 */
export function signalRays(signal: OneMinuteSignal, anchor: (epoch: number) => number | null): SignalRay[] {
  let asOf: number;
  try {
    asOf = Number(toChartTime(signal.as_of));
  } catch {
    return [];
  }
  if (!Number.isFinite(asOf)) return [];

  const start = anchor(asOf) ?? asOf;

  return signal.horizons
    .filter((h) => h.available)
    .map((h) => ({
      h: h.h,
      direction: h.direction,
      firm: h.confident && h.has_edge,
      points: [
        { time: start, value: signal.last_close },
        { time: asOf + h.h * 60, value: h.path_close },
      ],
    }));
}
