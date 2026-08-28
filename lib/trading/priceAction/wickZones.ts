import type { Candle } from '../marketData';
import type { Indicators } from '../indicators';
import { MIN_RR } from '../dayTrading/positionSize';
import type { PlanCheck, PlanDirection } from '../dayTrading/intradayPlan';

/**
 * Estrategia de mechas: zonas de rechazo como órdenes pendientes.
 *
 * Una mecha pronunciada dice dónde entró capital importante. El precio se movió
 * tan rápido en esa zona que muchas órdenes quedaron sin ejecutar, y cuando
 * vuelve a ella esas órdenes se activan y empujan en la nueva dirección. La
 * mecha inferior marca compras fuertes (demanda); la superior, ventas fuertes
 * (oferta).
 *
 * `api/intraday.py` ya detecta martillo y shooting star, pero solo devuelve
 * `{time, pattern, bias}`: sin geometría de zona, sin saber si el precio ya
 * volvió a testearla y sin operativa. Esta estrategia necesita las tres cosas,
 * así que se calcula aquí, en local, sobre las velas que el gráfico ya tiene.
 * Eso además la hace funcionar en cualquier temporalidad —incluida 1d— y sin
 * depender de la API de ML ni de un modelo entrenado, que es justo lo que pide
 * una estrategia pensada para cualquier mercado y cualquier marco temporal.
 *
 * Todo son funciones puras de su entrada, de modo que el overlay del gráfico y
 * el panel las llaman con las mismas velas y no pueden discrepar — el mismo
 * contrato que `buildIntradayPlan`.
 *
 * Los umbrales se calibran con ATR en lugar de con porcentajes fijos: es lo que
 * permite aplicar la misma regla a un índice, a una acción de 8 $ y a un cripto
 * sin tocar un solo parámetro.
 *
 * ⚠️ Guía educativa basada en reglas, NO una recomendación de inversión.
 */

/** La mecha tiene que dominar el rango de la vela. */
export const MIN_WICK_RATIO = 0.6;
/** …y ser claramente mayor que el cuerpo: rechazo, no continuación. */
export const MIN_WICK_BODY = 2;
/** …y significativa en precio, no solo en proporción. */
export const MIN_WICK_ATR = 0.8;
/** Alejamiento posterior que convierte la mecha en zona operable. */
export const MIN_IMPULSE_ATR = 1;
/**
 * Velas en las que se mide ese alejamiento.
 *
 * El "movimiento principal" de la estrategia es la reacción que sale de la zona,
 * no toda la historia posterior. Sin ventana, una zona de hace 300 velas hereda
 * la tendencia entera y declara impulsos de 28 ATR — un número que no describe
 * nada de lo que pasó al salir de la mecha.
 */
export const IMPULSE_WINDOW = 30;
/** Un retesteo dentro de estas velas sigue considerándose vivo. */
export const FRESH_BARS = 5;
export const MAX_ZONES = 6;
export const LOOKBACK = 300;

export type WickSide = 'demand' | 'supply';

/**
 * `pending`   — mecha detectada, el mercado aún no se ha alejado lo suficiente.
 * `armed`     — hubo movimiento principal y el precio todavía no ha vuelto.
 * `active`    — el precio acaba de regresar a la zona: es la señal de entrada.
 * `mitigated` — ya fue testeada hace tiempo; queda como referencia.
 */
export type ZoneStatus = 'pending' | 'armed' | 'active' | 'mitigated';

export type WickZone = {
  id: string;
  side: WickSide;
  direction: PlanDirection;
  /** Vela que imprimió la mecha. */
  time: number;
  index: number;
  /** La mecha *es* la zona. */
  top: number;
  bottom: number;
  /** Mecha / rango total de la vela. */
  wickRatio: number;
  /** Alejamiento máximo posterior, medido en ATR. */
  impulse: number;
  status: ZoneStatus;
  /** Vela en la que el precio volvió a entrar en la zona. */
  retestTime: number | null;
  /** Último máximo (demanda) o mínimo (oferta) relevante: el objetivo. */
  target: number | null;
  /** Velas transcurridas desde la mecha. */
  age: number;
};

export type WickSetup = {
  zone: WickZone;
  direction: PlanDirection;
  lastPrice: number;
  entry: [number, number];
  entryMid: number;
  entryType: string;
  stopLoss: number;
  takeProfit: [number, number];
  riskReward: number;
  checklist: PlanCheck[];
  rationale: string;
};

export type WickInput = {
  candles: Candle[];
  indicators: Indicators;
};

const round = (value: number) => Math.round(value * 10000) / 10000;

/**
 * ATR de la vela `i`, con respaldo mientras la serie calienta.
 *
 * `calculateATR` deja NaN en las primeras 14 velas, y son justo las que abren la
 * ventana visible en marcos cortos; sin respaldo la estrategia se quedaría ciega
 * al principio del gráfico.
 */
function atrAt(atr14: number[], index: number, fallback: number): number {
  const value = atr14[index];
  if (Number.isFinite(value) && value > 0) return value;
  return fallback;
}

/** Mediana del rango de las velas: sustituto razonable del ATR cuando no lo hay. */
function medianRange(candles: Candle[]): number {
  const ranges = candles
    .map((candle) => candle.high - candle.low)
    .filter((range) => Number.isFinite(range) && range > 0)
    .sort((a, b) => a - b);

  if (ranges.length === 0) return 0;
  return ranges[Math.floor(ranges.length / 2)];
}

/**
 * Pivotes fractales: un máximo (o mínimo) que domina su ventana de ±span velas.
 *
 * Mismo criterio que `find_fractals(df, left=2, right=2)` en `api/intraday.py`,
 * reimplementado aquí porque esa versión vive en Python y solo se expone para
 * temporalidades intradía — este overlay tiene que funcionar también en 1d y sin
 * red.
 */
function swingPoints(candles: Candle[], span = 2): { highs: number[]; lows: number[] } {
  const highs: number[] = [];
  const lows: number[] = [];

  for (let i = span; i < candles.length - span; i++) {
    let isHigh = true;
    let isLow = true;

    for (let j = i - span; j <= i + span; j++) {
      if (j === i) continue;
      if (candles[j].high >= candles[i].high) isHigh = false;
      if (candles[j].low <= candles[i].low) isLow = false;
    }

    if (isHigh) highs.push(i);
    if (isLow) lows.push(i);
  }

  return { highs, lows };
}

/**
 * El "último máximo o mínimo relevante" al que apunta la estrategia.
 *
 * Se busca dentro del tramo que va de la mecha al final del recorrido: es el
 * extremo que el movimiento principal alcanzó, es decir, hasta dónde llegó la
 * fuerza que dejó las órdenes en la zona. Si no hay ningún pivote confirmado en
 * ese tramo (movimiento demasiado corto), se usa el extremo bruto.
 */
function relevantExtreme(
  candles: Candle[],
  swings: { highs: number[]; lows: number[] },
  side: WickSide,
  from: number,
  to: number
): number | null {
  if (to <= from) return null;

  const pivots = (side === 'demand' ? swings.highs : swings.lows).filter(
    (index) => index > from && index <= to
  );

  if (pivots.length > 0) {
    const values = pivots.map((index) => (side === 'demand' ? candles[index].high : candles[index].low));
    return side === 'demand' ? Math.max(...values) : Math.min(...values);
  }

  const slice = candles.slice(from + 1, to + 1);
  if (slice.length === 0) return null;

  return side === 'demand'
    ? Math.max(...slice.map((candle) => candle.high))
    : Math.min(...slice.map((candle) => candle.low));
}

/**
 * Recorre las velas y devuelve las zonas de mecha todavía vivas, la más reciente
 * primero.
 */
export function detectWickZones({ candles, indicators }: WickInput): WickZone[] {
  if (candles.length < 10) return [];

  const start = Math.max(0, candles.length - LOOKBACK);
  const fallbackAtr = medianRange(candles.slice(start));
  if (fallbackAtr <= 0) return [];

  const swings = swingPoints(candles);
  const lastIndex = candles.length - 1;
  const zones: WickZone[] = [];

  for (let i = start; i < lastIndex; i++) {
    const candle = candles[i];
    const range = candle.high - candle.low;
    if (!Number.isFinite(range) || range <= 0) continue;

    const body = Math.abs(candle.close - candle.open);
    const bodyTop = Math.max(candle.open, candle.close);
    const bodyBottom = Math.min(candle.open, candle.close);
    const upper = candle.high - bodyTop;
    const lower = bodyBottom - candle.low;
    const atr = atrAt(indicators.atr14, i, fallbackAtr);

    // Una vela produce como mucho una zona: gana la mecha dominante. Una vela con
    // dos mechas largas es indecisión, no rechazo, y la comparación la descarta
    // sola porque ninguna de las dos llega al 60% del rango.
    const side: WickSide | null =
      lower >= upper
        ? lower >= MIN_WICK_RATIO * range && lower >= MIN_WICK_BODY * body && lower >= MIN_WICK_ATR * atr
          ? 'demand'
          : null
        : upper >= MIN_WICK_RATIO * range && upper >= MIN_WICK_BODY * body && upper >= MIN_WICK_ATR * atr
          ? 'supply'
          : null;

    if (side === null) continue;

    const demand = side === 'demand';
    const top = demand ? bodyBottom : candle.high;
    const bottom = demand ? candle.low : bodyTop;
    const wick = demand ? lower : upper;

    // --- Qué hizo el precio después ---------------------------------------
    let impulse = 0;
    let armedAt = -1;
    let retestIndex = -1;
    let invalidated = false;
    let end = lastIndex;

    for (let j = i + 1; j <= lastIndex; j++) {
      const next = candles[j];

      // El capital que defendía la zona se rindió. Se mira el cierre, no la
      // mecha: un barrido que vuelve dentro no invalida nada, es justo lo que
      // hace esta estrategia.
      if (demand ? next.close < bottom : next.close > top) {
        invalidated = true;
        break;
      }

      // Una vez testeada, el recorrido ya está descrito: lo único que queda por
      // vigilar hasta la última vela es que la zona siga aguantando. Salir del
      // bucle aquí dejaría viva una zona que el precio perforó *después* del
      // retesteo, que es precisamente la que no hay que operar.
      if (retestIndex !== -1) continue;

      if (j - i <= IMPULSE_WINDOW) {
        const excursion = demand ? next.high - top : bottom - next.low;
        if (excursion > impulse * atr) impulse = excursion / atr;
        if (armedAt === -1 && impulse >= MIN_IMPULSE_ATR) armedAt = j;
      }

      // El regreso a la zona solo cuenta una vez armada: antes del movimiento
      // principal el precio todavía no se ha ido a ninguna parte.
      if (armedAt !== -1 && j > armedAt && next.low <= top && next.high >= bottom) {
        retestIndex = j;
        end = j;
      }
    }

    if (invalidated) continue;

    const status: ZoneStatus =
      retestIndex !== -1
        ? lastIndex - retestIndex <= FRESH_BARS
          ? 'active'
          : 'mitigated'
        : armedAt !== -1
          ? 'armed'
          : 'pending';

    zones.push({
      id: `${candle.time}-${side}`,
      side,
      direction: demand ? 'long' : 'short',
      time: candle.time,
      index: i,
      top: round(top),
      bottom: round(bottom),
      wickRatio: Math.round((wick / range) * 100) / 100,
      impulse: Math.round(impulse * 100) / 100,
      status,
      retestTime: retestIndex === -1 ? null : candles[retestIndex].time,
      target: relevantExtreme(candles, swings, side, i, end),
      age: lastIndex - i,
    });
  }

  return zones.reverse().slice(0, MAX_ZONES);
}

/** Prioridad operativa: la zona en la que el precio está ahora manda. */
const RANK: Record<ZoneStatus, number> = { active: 0, armed: 1, pending: 2, mitigated: 3 };

/**
 * La operativa de la zona que toca vigilar: entrada en la propia zona, stop al
 * otro lado y objetivo en el último extremo relevante.
 */
export function buildWickSetup(
  zones: WickZone[],
  { candles, indicators }: WickInput
): WickSetup | null {
  const last = candles[candles.length - 1];
  if (!last || zones.length === 0) return null;

  const lastPrice = last.close;
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) return null;

  const fallbackAtr = medianRange(candles);
  const atr = atrAt(indicators.atr14, candles.length - 1, fallbackAtr);
  if (atr <= 0) return null;

  // Una zona a más de 2 ATR no es un setup, es una anotación: el precio tendría
  // que recorrer todo el camino antes de que la entrada existiera siquiera.
  const distance = (zone: WickZone) =>
    Math.max(zone.bottom - lastPrice, lastPrice - zone.top, 0);

  const candidates = zones
    .filter((zone) => zone.status !== 'mitigated' && distance(zone) <= atr * 2)
    .sort((a, b) => RANK[a.status] - RANK[b.status] || distance(a) - distance(b));

  const zone = candidates[0];
  if (!zone) return null;

  const long = zone.direction === 'long';

  // Colchón para que el stop no muera por el ruido del propio rechazo — mismo
  // criterio que el `buffer` del plan intradía.
  const buffer = Math.max(atr * 0.25, lastPrice * 0.001);

  const entry: [number, number] = [zone.bottom, zone.top];
  const entryMid = round((zone.bottom + zone.top) / 2);
  const stopLoss = round(long ? zone.bottom - buffer : zone.top + buffer);

  const risk = Math.abs(entryMid - stopLoss);
  if (risk <= 0) return null;

  // Sin extremo relevante que apuntar, se proyecta el riesgo: un plan sin
  // objetivo no es un plan.
  const projected = (multiple: number) => (long ? entryMid + risk * multiple : entryMid - risk * multiple);
  const reaches = zone.target !== null && (long ? zone.target - entryMid >= risk : entryMid - zone.target >= risk);

  const tp1 = reaches ? (zone.target as number) : projected(2);
  const tp2 = long ? tp1 + (tp1 - entryMid) : tp1 - (entryMid - tp1);

  const takeProfit: [number, number] = [round(tp1), round(tp2)];
  const riskReward = Math.round((Math.abs(takeProfit[0] - entryMid) / risk) * 100) / 100;

  const entryType = long
    ? 'Compra en zona de mecha inferior (retesteo)'
    : 'Venta en zona de mecha superior (retesteo)';

  const checklist: PlanCheck[] = [
    {
      label: `Mecha ≥ ${Math.round(MIN_WICK_RATIO * 100)}% del rango`,
      ok: zone.wickRatio >= MIN_WICK_RATIO,
      detail: `${Math.round(zone.wickRatio * 100)}% de la vela`,
    },
    {
      label: `Movimiento principal ≥ ${MIN_IMPULSE_ATR} ATR`,
      ok: zone.impulse >= MIN_IMPULSE_ATR,
      detail: `${zone.impulse.toFixed(2)} ATR de alejamiento`,
    },
    {
      label: 'Precio de vuelta en la zona',
      ok: zone.status === 'active',
      detail:
        zone.status === 'active'
          ? 'Retesteo en curso'
          : zone.status === 'armed'
            ? 'Zona armada, esperando el regreso'
            : 'Aún sin movimiento principal',
    },
    {
      label: `Relación R/R ≥ ${MIN_RR}`,
      ok: riskReward >= MIN_RR,
      detail: `1:${riskReward}`,
    },
  ];

  const rationale =
    `${entryType}. La mecha marca dónde entró capital y quedaron órdenes sin ejecutar; ` +
    `el stop va ${long ? 'por debajo' : 'por encima'} de la zona y el objetivo en el último ` +
    `${long ? 'máximo' : 'mínimo'} relevante. ` +
    'Guía educativa basada en reglas, no es una recomendación de inversión.';

  return {
    zone,
    direction: zone.direction,
    lastPrice: round(lastPrice),
    entry,
    entryMid,
    entryType,
    stopLoss,
    takeProfit,
    riskReward,
    checklist,
    rationale,
  };
}
