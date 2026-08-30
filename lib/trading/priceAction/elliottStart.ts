import type { Candle } from '../marketData';
import type { Indicators } from '../indicators';
import type { PlanDirection } from '../dayTrading/intradayPlan';

/**
 * Probabilidad de que esté empezando un impulso de Elliott.
 *
 * El Elliott que ya había en el repo (`api/elliott.py`, `api/technical.py`) hace
 * otra cosa: busca ventanas cerradas de seis pivotes 0-1-2-3-4-5 y puntúa lo
 * bonito que es el conteo con una fórmula geométrica. No existe el concepto de
 * "una onda puede estar empezando", solo cuenta impulsos alcistas, y sus tres
 * reglas cardinales son un filtro (`if not (r1 and r2 and r3): continue`), así
 * que el flag de reglas siempre sale ✓ y no informa de nada.
 *
 * Aquí se modela lo contrario: el arranque. Tras la onda 1 y su corrección
 * (onda 2), la onda 3 está por empezar; lo que se puntúa es cuánto se parece esa
 * estructura a un arranque válido, con las reglas **graduadas** (margen hasta la
 * invalidación) en lugar de en pass/fail. Se confirma cuando el precio supera el
 * final de la onda 1, y se invalida cuando pierde el origen — la regla dura.
 *
 * Cálculo local sobre las velas cargadas: funciona en cualquier temporalidad y
 * sin API de ML ni modelo entrenado, al contrario que el overlay «ZigZag +
 * Elliott», limitado a 1d y a tickers con XGBoost.
 *
 * ⚠️ CAUSALIDAD. Todo aquí se evalúa con lo que se sabía en cada vela, nunca con
 * lo que vino después. Un pivote de zigzag en la vela `j` no se conoce en `j`:
 * solo se sabe que era un extremo cuando el precio ya se ha girado el umbral
 * completo, varias velas más tarde — por eso cada pivote lleva `confirmedAt`. Sin
 * eso, la curva mostraría probabilidades que nadie pudo ver y la calibración
 * saldría inflada: el gráfico mentiría.
 *
 * ⚠️ Guía educativa basada en reglas, NO una recomendación de inversión.
 */

/**
 * Giro necesario para dar un pivote por bueno, en múltiplos de ATR.
 *
 * Fija el grado de onda que se está contando, y con él todo lo demás. A 2·ATR
 * salen swings de 5-7 velas: eso no es un impulso, es ruido con forma de zigzag.
 * A 3·ATR la onda 1 dura ~15 velas, que sí es una estructura, y en NVDA y AAPL
 * (15m) la tasa de confirmación sube del 15-33% al 50-80%.
 *
 * La muestra de ese contraste es pequeña (4-8 candidatos resueltos por umbral),
 * así que el número exacto es orientativo; lo que sostiene el 3 es el grado de
 * onda, no el ajuste.
 */
export const ZIGZAG_ATR = 3;
/** Velas mínimas antes de evaluar nada: el ATR necesita calentar. */
export const WARMUP = 20;
/** Umbrales sobre los que se mide el acierto histórico. */
export const CALIBRATION_BUCKETS = [50, 70];

export type ZigPivot = {
  /** Vela del extremo. */
  index: number;
  time: number;
  price: number;
  type: 'high' | 'low';
  /** Vela en la que el giro confirmó el pivote. Siempre >= index. */
  confirmedAt: number;
};

export type ElliottState = 'forming' | 'confirmed' | 'invalidated';

export type ElliottFactor = {
  label: string;
  /** 0–1. */
  score: number;
  weight: number;
  detail: string;
};

export type ElliottCandidate = {
  direction: PlanDirection;
  /** Origen de la onda 1, final de la onda 1, final de la onda 2. */
  wave0: ZigPivot;
  wave1: ZigPivot;
  wave2: ZigPivot;
  probability: number;
  /**
   * Máximo que alcanzó la probabilidad mientras el recuento estaba vivo.
   *
   * `probability` se pone a 0 al resolverse, así que la calibración necesita
   * este otro número: lo que el oscilador llegó a marcar antes de saberse el
   * desenlace es justo lo que hay que contrastar contra ese desenlace.
   */
  peakProbability: number;
  factors: ElliottFactor[];
  state: ElliottState;
  /** Vela en la que se confirmó o se invalidó. */
  resolvedAt: number | null;
  resolvedTime: number | null;
  /** Superarlo confirma la onda 3. */
  trigger: number;
  /** Perderlo mata el recuento. */
  invalidation: number;
  /** Retroceso de la onda 2 sobre la onda 1. */
  retracement: number;
};

export type ElliottInput = {
  candles: Candle[];
  indicators: Indicators;
};

export type CalibrationBucket = {
  threshold: number;
  total: number;
  confirmed: number;
  /** Porcentaje de aciertos, o null si no hay muestra. */
  rate: number | null;
};

const clamp01 = (value: number) => (value < 0 ? 0 : value > 1 ? 1 : value);

/**
 * Umbral del zigzag vela a vela, siempre con información pasada.
 *
 * El ATR deja NaN en las primeras velas, así que se respalda con la media
 * acumulada de rangos — que también es causal. Usar la mediana de toda la serie,
 * como hace `wickZones`, aquí no valdría: metería el futuro en el umbral.
 */
function causalThresholds(candles: Candle[], atr14: number[]): number[] {
  const thresholds: number[] = new Array(candles.length).fill(0);
  let sum = 0;

  for (let i = 0; i < candles.length; i++) {
    const range = candles[i].high - candles[i].low;
    if (Number.isFinite(range) && range > 0) sum += range;

    const atr = atr14[i];
    const reference = Number.isFinite(atr) && atr > 0 ? atr : sum / (i + 1);
    thresholds[i] = reference * ZIGZAG_ATR;
  }

  return thresholds;
}

/**
 * ZigZag alternado sobre máximos y mínimos, no sobre cierres.
 *
 * Los zigzag de Python trabajan solo con cierres y con un porcentaje fijo (3%
 * diario, 0.4% intradía). Con umbral en ATR el mismo código sirve para 1m y para
 * 1d, y en cualquier activo, que es lo que necesita un overlay sin parámetros.
 */
export function zigzagPivots({ candles, indicators }: ElliottInput): ZigPivot[] {
  if (candles.length < 3) return [];

  const thresholds = causalThresholds(candles, indicators.atr14);
  const pivots: ZigPivot[] = [];

  // 0 = todavía sin dirección: se vigilan los dos lados y gana el que gire antes.
  let dir: -1 | 0 | 1 = 0;
  let hiIndex = 0;
  let hiPrice = candles[0].high;
  let loIndex = 0;
  let loPrice = candles[0].low;

  for (let i = 1; i < candles.length; i++) {
    const candle = candles[i];
    const threshold = thresholds[i];
    if (!(threshold > 0)) continue;

    if (dir >= 0 && candle.high > hiPrice) {
      hiPrice = candle.high;
      hiIndex = i;
    }
    if (dir <= 0 && candle.low < loPrice) {
      loPrice = candle.low;
      loIndex = i;
    }

    // Giro a la baja: el máximo que veníamos siguiendo era un pivote, y se
    // aprende ahora — en la vela i, no en la del extremo.
    if (dir >= 0 && hiPrice - candle.low >= threshold) {
      pivots.push({
        index: hiIndex,
        time: candles[hiIndex].time,
        price: hiPrice,
        type: 'high',
        confirmedAt: i,
      });
      dir = -1;
      loIndex = i;
      loPrice = candle.low;
      continue;
    }

    if (dir <= 0 && candle.high - loPrice >= threshold) {
      pivots.push({
        index: loIndex,
        time: candles[loIndex].time,
        price: loPrice,
        type: 'low',
        confirmedAt: i,
      });
      dir = 1;
      hiIndex = i;
      hiPrice = candle.high;
      continue;
    }
  }

  return pivots;
}

/** Media de un tramo, tolerante a tramos vacíos. */
function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/**
 * Cuánto se parece el retroceso de la onda 2 a un retroceso de libro.
 *
 * Máximo en la banda 0.5–0.618, decae hacia 0.382 y 0.786, y cae a cero al pasar
 * del 100 %: eso ya no es una onda 2, es la regla cardinal rota.
 */
function retracementScore(r: number): number {
  if (r <= 0 || r >= 1) return 0;
  if (r < 0.382) return (r / 0.382) * 0.6;
  if (r < 0.5) return 0.6 + ((r - 0.382) / (0.5 - 0.382)) * 0.4;
  if (r <= 0.618) return 1;
  if (r <= 0.786) return 1 - ((r - 0.618) / (0.786 - 0.618)) * 0.4;
  return 0.6 - ((r - 0.786) / (1 - 0.786)) * 0.6;
}

/**
 * Evalúa el candidato vivo en la vela `at` con los pivotes conocidos entonces.
 *
 * `pivots` debe venir ya filtrado por `confirmedAt <= at`; la función no vuelve a
 * comprobarlo para poder llamarse en bucle sin recortar el array cada vez.
 */
function evaluate(
  pivots: ZigPivot[],
  known: number,
  at: number,
  { candles, indicators }: ElliottInput
): ElliottCandidate | null {
  if (known < 3) return null;

  const wave0 = pivots[known - 3];
  const wave1 = pivots[known - 2];
  const wave2 = pivots[known - 1];

  // Alcista: mínimo → máximo → mínimo. Bajista, el espejo. El detector de
  // Python solo contempla el primero.
  const long = wave0.type === 'low' && wave1.type === 'high' && wave2.type === 'low';
  const short = wave0.type === 'high' && wave1.type === 'low' && wave2.type === 'high';
  if (!long && !short) return null;

  const wave1Size = Math.abs(wave1.price - wave0.price);
  const wave2Size = Math.abs(wave1.price - wave2.price);
  if (wave1Size <= 0) return null;

  const retracement = wave2Size / wave1Size;
  const direction: PlanDirection = long ? 'long' : 'short';
  const trigger = wave1.price;
  const invalidation = wave0.price;

  // --- Estado: lo primero que ocurra manda ---------------------------------
  let state: ElliottState = 'forming';
  let resolvedAt: number | null = null;

  // Un retroceso de más del 100% no es una onda 2 profunda: es la regla cardinal
  // rota, el recuento nace muerto. Hay que cortarlo aquí y no dejar que los otros
  // factores lo mantengan con vida — con la regla como un sumando más, una
  // estructura imposible seguía puntuando un 38%.
  if (retracement >= 1) {
    state = 'invalidated';
    resolvedAt = wave2.index;
  }

  // Los dos umbrales se miden distinto a propósito:
  //   · la invalidación es la regla estructural de Elliott —la onda 2 no puede
  //     pasar del origen de la onda 1— y se aplica al extremo, como se cuenta
  //     una onda: si la mecha llegó ahí, el recuento ya no es válido;
  //   · la confirmación es un disparo operativo, y ahí manda el cierre, para que
  //     un barrido no dé por arrancada una onda 3 que no existe.
  for (let i = wave2.index + 1; state === 'forming' && i <= at; i++) {
    const candle = candles[i];

    if (long ? candle.low < invalidation : candle.high > invalidation) {
      state = 'invalidated';
      resolvedAt = i;
      break;
    }
    if (long ? candle.close > trigger : candle.close < trigger) {
      state = 'confirmed';
      resolvedAt = i;
      break;
    }
  }

  const factors: ElliottFactor[] = [];
  const add = (label: string, score: number, weight: number, detail: string) =>
    factors.push({ label, score: clamp01(score), weight, detail });

  // 1 · Retroceso de la onda 2
  add(
    'Retroceso de la onda 2',
    retracementScore(retracement),
    30,
    `${(retracement * 100).toFixed(0)}% de la onda 1`
  );

  // 2 · Margen hasta la invalidación. No es el retroceso otra vez: mide hasta
  // dónde ha llegado el precio DESPUÉS del pivote, que puede haber tanteado el
  // origen sin llegar a formar un pivote nuevo.
  let worst = wave2.price;
  for (let i = wave2.index; i <= at; i++) {
    worst = long ? Math.min(worst, candles[i].low) : Math.max(worst, candles[i].high);
  }
  const margin = (long ? worst - invalidation : invalidation - worst) / wave1Size;
  add(
    'Margen hasta la invalidación',
    margin,
    15,
    `${(margin * 100).toFixed(0)}% de la onda 1 por encima de ${invalidation.toFixed(2)}`
  );

  // 3 · Impulsividad de la onda 1: tamaño y rectitud. Una pata limpia es un
  // impulso; una serrada del mismo tamaño es lateralidad.
  const atr = indicators.atr14[at];
  const reference = Number.isFinite(atr) && atr > 0 ? atr : wave1Size / 3;
  const sizeScore = clamp01(wave1Size / (reference * 3));

  let path = 0;
  for (let i = wave0.index + 1; i <= wave1.index; i++) path += candles[i].high - candles[i].low;
  const straight = path > 0 ? wave1Size / path : 0;
  const straightScore = clamp01(straight / 0.4);

  add(
    'Impulsividad de la onda 1',
    sizeScore * 0.5 + straightScore * 0.5,
    20,
    `${(wave1Size / reference).toFixed(1)} ATR · rectitud ${(straight * 100).toFixed(0)}%`
  );

  // 4 · Alineación de tendencia
  const ema20 = indicators.ema20[at];
  const ema50 = indicators.ema50[at];
  const close = candles[at].close;
  const trendChecks = [
    Number.isFinite(ema20) && Number.isFinite(ema50) && (long ? ema20 > ema50 : ema20 < ema50),
    Number.isFinite(ema20) && (long ? close > ema20 : close < ema20),
  ];
  add(
    'Alineación de tendencia',
    trendChecks.filter(Boolean).length / trendChecks.length,
    15,
    `EMA20/50 y precio ${trendChecks.every(Boolean) ? 'a favor' : trendChecks.some(Boolean) ? 'mixtos' : 'en contra'}`
  );

  // 5 · Volumen: la onda 1 empuja, la onda 2 se seca. Guía clásica de Elliott.
  const priorVolume = mean(
    candles.slice(Math.max(0, wave0.index - 20), wave0.index).map((candle) => candle.volume || 0)
  );
  const wave1Volume = mean(candles.slice(wave0.index, wave1.index + 1).map((candle) => candle.volume || 0));
  const wave2Volume = mean(candles.slice(wave1.index, wave2.index + 1).map((candle) => candle.volume || 0));
  const volumeChecks = [
    priorVolume > 0 && wave1Volume > priorVolume,
    wave1Volume > 0 && wave2Volume < wave1Volume,
  ];
  add(
    'Volumen 1 sube / 2 seca',
    volumeChecks.filter(Boolean).length / volumeChecks.length,
    10,
    volumeChecks.every(Boolean) ? 'ambas se cumplen' : volumeChecks.some(Boolean) ? 'solo una' : 'ninguna'
  );

  // 6 · Proporción temporal: la corrección suele durar menos que el impulso.
  const wave1Bars = Math.max(1, wave1.index - wave0.index);
  const wave2Bars = Math.max(1, wave2.index - wave1.index);
  const ratio = wave2Bars / wave1Bars;
  add(
    'Proporción temporal',
    (2 - ratio) / 1.5,
    10,
    `${wave2Bars} velas de corrección frente a ${wave1Bars} de impulso`
  );

  const raw = factors.reduce((sum, factor) => sum + factor.score * factor.weight, 0);

  // Una vez resuelto ya no hay nada que pronosticar: o arrancó, o murió.
  const probability = state === 'forming' ? Math.round(raw) : 0;

  return {
    direction,
    wave0,
    wave1,
    wave2,
    probability,
    peakProbability: probability,
    factors,
    state,
    resolvedAt,
    resolvedTime: resolvedAt === null ? null : candles[resolvedAt].time,
    trigger,
    invalidation,
    retracement,
  };
}

/** El candidato tal y como se veía en cada vela: la curva del oscilador. */
export function elliottProbabilitySeries(input: ElliottInput): {
  series: { time: number; value: number }[];
  candidates: ElliottCandidate[];
  current: ElliottCandidate | null;
} {
  const { candles } = input;
  const series: { time: number; value: number }[] = [];
  const candidates: ElliottCandidate[] = [];

  if (candles.length <= WARMUP) return { series, candidates, current: null };

  const pivots = zigzagPivots(input);
  let known = 0;
  let lastKey = '';
  let current: ElliottCandidate | null = null;

  for (let i = WARMUP; i < candles.length; i++) {
    // Los pivotes entran en juego en su vela de confirmación, no en la del
    // extremo: es lo único que hace honesta a la curva.
    while (known < pivots.length && pivots[known].confirmedAt <= i) known++;

    const candidate = evaluate(pivots, known, i, input);
    series.push({ time: candles[i].time, value: candidate?.probability ?? 0 });

    if (!candidate) continue;

    // Un candidato es el mismo mientras lo definan los mismos tres pivotes; se
    // guarda su última evaluación, que es la que ya conoce el desenlace.
    const key = `${candidate.wave0.index}-${candidate.wave1.index}-${candidate.wave2.index}`;

    if (key === lastKey) {
      const previous = candidates[candidates.length - 1];
      candidate.peakProbability = Math.max(previous.peakProbability, candidate.probability);
      candidates[candidates.length - 1] = candidate;
    } else {
      candidates.push(candidate);
      lastKey = key;
    }

    current = candidates[candidates.length - 1];
  }

  return { series, candidates, current };
}

/**
 * Cuántos de los candidatos pasados acabaron confirmándose.
 *
 * Es lo que convierte el número en algo comprobable en lugar de una opinión: si
 * de los que marcaron ≥70 % se confirmó la mitad, el oscilador lo dice.
 */
export function calibrate(candidates: ElliottCandidate[]): CalibrationBucket[] {
  // El único candidato que de verdad sigue pendiente es el vivo; el resto, aunque
  // se quedaran en 'forming', ya no van a confirmar nada: los relevaron pivotes
  // nuevos sin haber superado la onda 1. Contarlos como "aún por ver" sería
  // exactamente el sesgo que hace que estos números parezcan mejores de lo que
  // son — que es el defecto del `confidence` que ya traía el repo.
  const last = candidates[candidates.length - 1];
  const settled = candidates.filter((candidate) => candidate !== last || candidate.state !== 'forming');

  return CALIBRATION_BUCKETS.map((threshold) => {
    const sample = settled.filter((candidate) => candidate.peakProbability >= threshold);
    const confirmed = sample.filter((candidate) => candidate.state === 'confirmed').length;

    return {
      threshold,
      total: sample.length,
      confirmed,
      rate: sample.length === 0 ? null : Math.round((confirmed / sample.length) * 100),
    };
  });
}
