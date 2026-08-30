import { snapIndex } from '../chartTime';
import type { Candle } from '../marketData';

/**
 * Las alertas de `/signals`, listas para dibujarse en el gráfico.
 *
 * `api/signals.py` ya cruza el sesgo diario de XGBoost con la estructura
 * intradía y emite alertas con hora, dirección, fuerza y sus razones — es el
 * mismo tipo de flujo que muestra Trade Ideas. Hasta ahora solo se veían como
 * lista en `SignalsPanel`; esto las ancla a su vela y les mide el recorrido
 * posterior, que es lo que dice si la señal sirvió de algo.
 *
 * Función pura: el overlay del gráfico y cualquier panel que la use verán
 * exactamente lo mismo.
 *
 * ⚠️ El recorrido es lo que hizo el precio DESPUÉS de la señal sobre las velas
 * cargadas. Es una medición a posteriori, no una promesa ni un backtest.
 */

/** Una alerta tal y como llega de `/signals`. */
export type RawAlert = {
  time: string | number;
  /** 'COMPRA' o 'VENTA', como las escribe `api/signals.py`. */
  direction: string;
  strength: string;
  aligned_with_daily: boolean;
  trigger: string;
  level: number;
  price: number;
  reasons: string[];
};

export type SignalDirection = 'buy' | 'sell';

export type SignalCallout = {
  /** Vela a la que se ancla, en epoch de segundos. */
  time: number;
  index: number;
  direction: SignalDirection;
  /** Texto del bocadillo. */
  label: string;
  price: number;
  level: number;
  strength: string;
  trigger: string;
  /** Alineada con el sesgo diario: se dibuja en sólido en vez de tenue. */
  aligned: boolean;
  reasons: string[];
  /** Mejor recorrido posterior en %, o null si no hay velas después. */
  followThrough: number | null;
  peakTime: number | null;
  peakPrice: number | null;
};

/** Cuántas señales caben en el gráfico sin taparlo. */
export const MAX_CALLOUTS = 6;

function directionOf(raw: string): SignalDirection {
  return raw.toUpperCase().startsWith('VENTA') || raw.toUpperCase().startsWith('SELL') ? 'sell' : 'buy';
}

/**
 * Lo mejor que hizo el precio después de la señal.
 *
 * La vela de la propia señal queda fuera a propósito: su máximo pudo imprimirse
 * antes de que la alerta existiera, y contarlo inflaría el resultado.
 */
function followThrough(
  candles: Candle[],
  index: number,
  price: number,
  direction: SignalDirection
): Pick<SignalCallout, 'followThrough' | 'peakTime' | 'peakPrice'> {
  const rest = candles.slice(index + 1);

  if (rest.length === 0 || !Number.isFinite(price) || price <= 0) {
    return { followThrough: null, peakTime: null, peakPrice: null };
  }

  let best = rest[0];
  let bestPrice = direction === 'buy' ? rest[0].high : rest[0].low;

  for (const candle of rest) {
    const value = direction === 'buy' ? candle.high : candle.low;
    if (direction === 'buy' ? value > bestPrice : value < bestPrice) {
      bestPrice = value;
      best = candle;
    }
  }

  const move = direction === 'buy' ? bestPrice - price : price - bestPrice;

  return {
    followThrough: Math.round((move / price) * 1000) / 10,
    peakTime: best.time,
    peakPrice: bestPrice,
  };
}

export function buildSignalCallouts(
  alerts: RawAlert[],
  candles: Candle[],
  max = MAX_CALLOUTS
): SignalCallout[] {
  if (candles.length === 0 || alerts.length === 0) return [];

  const times = candles.map((candle) => candle.time);
  const byIndex = new Map<number, SignalCallout>();

  for (const alert of alerts) {
    const index = snapIndex(times, alert.time);
    if (index === null) continue;

    const direction = directionOf(alert.direction);

    // Dos alertas dentro de la misma vela darían dos bocadillos superpuestos e
    // ilegibles; se queda la primera, que es la que `api/signals.py` ordenó
    // como más relevante.
    if (byIndex.has(index)) continue;

    byIndex.set(index, {
      time: candles[index].time,
      index,
      direction,
      label: direction === 'buy' ? 'BUY SIGNAL' : 'SELL SIGNAL',
      price: alert.price,
      level: alert.level,
      strength: alert.strength,
      trigger: alert.trigger,
      aligned: alert.aligned_with_daily,
      reasons: alert.reasons,
      ...followThrough(candles, index, alert.price, direction),
    });
  }

  // Las alineadas con el sesgo diario mandan; entre iguales, las más recientes.
  // Después se reordenan por tiempo, que es como hay que dibujarlas.
  return Array.from(byIndex.values())
    .sort((a, b) => Number(b.aligned) - Number(a.aligned) || b.index - a.index)
    .slice(0, max)
    .sort((a, b) => a.index - b.index);
}

/**
 * Un bocadillo de resultado por vela de pico.
 *
 * Varias señales seguidas suelen desembocar en el mismo máximo, y sus etiquetas
 * caerían exactamente en las mismas coordenadas: se leería una sola y las demás
 * quedarían debajo, invisibles. Se queda la de mayor recorrido, que es la que
 * describe el movimiento completo.
 */
export function bestOutcomePerPeak(callouts: SignalCallout[]): SignalCallout[] {
  const byPeak = new Map<number, SignalCallout>();

  for (const callout of callouts) {
    if (callout.followThrough === null || callout.peakTime === null) continue;

    const current = byPeak.get(callout.peakTime);
    if (!current || callout.followThrough > (current.followThrough as number)) {
      byPeak.set(callout.peakTime, callout);
    }
  }

  return Array.from(byPeak.values()).sort((a, b) => a.index - b.index);
}
