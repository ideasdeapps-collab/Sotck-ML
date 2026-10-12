import { isValidTicker } from '../liveQuote/sources';
import { etDayStart, previousRegularClose, type Bar } from '../aiEcosystem/moves';
import { etParts, etWallClockToEpoch } from '../chartTime';

/**
 * Carreras al estilo del «Stock Race» de Trade Ideas.
 *
 * - Día (por defecto): la salida es el cierre regular anterior, así que la
 *   posición de cada coche es su «% del día»; una foto por minuto desde la
 *   apertura (o desde el premarket si aún no abrió).
 * - 5 min: todos salen a la vez desde 0 % hace 5 minutos; cada foto (una por minuto)
 * dice cuánto ha subido o bajado cada uno desde la salida. El reloj es común:
 * la última barra de cualquiera de ellos. Un ticker sin operaciones en un
 * minuto se queda en su último precio, como en un gráfico de 1 min.
 */

export type RaceMode = 'day' | '5m';
export const RACE_MODES: RaceMode[] = ['day', '5m'];

export const RACE_MINUTES = 5;
export const MAX_RACE_TICKERS = 12;
/** Por debajo de este %, mover los coches a todo el ancho convertiría ruido en una carrera. */
const MIN_SCALE = 0.1;

const MINUTE = 60_000;

export type RaceLane = { ticker: string; price: number | null; path: (number | null)[] };
export type Race = { frames: number[]; lanes: RaceLane[] };

function closeAtOrBefore(bars: Bar[], limit: number): number | null {
  let close: number | null = null;
  for (const bar of bars) {
    if (bar.t > limit) break;
    close = bar.c;
  }
  return close;
}

export function raceFrames(barsByTicker: Record<string, Bar[]>, minutes = RACE_MINUTES): Race {
  const sorted = Object.fromEntries(
    Object.entries(barsByTicker).map(([ticker, bars]) => [ticker, [...bars].sort((a, b) => a.t - b.t)])
  );

  const end = Math.max(0, ...Object.values(sorted).map((bars) => bars[bars.length - 1]?.t ?? 0));
  const frames = end > 0 ? Array.from({ length: minutes + 1 }, (_, i) => end - (minutes - i) * MINUTE) : [];

  const lanes = Object.entries(sorted).map(([ticker, bars]): RaceLane => {
    const start = frames.length > 0 ? closeAtOrBefore(bars, frames[0]) : null;
    const path = frames.map((time) => {
      const close = closeAtOrBefore(bars, time);
      return start && close ? (close / start - 1) * 100 : null;
    });
    return { ticker, price: bars[bars.length - 1]?.c ?? null, path };
  });

  return { frames, lanes };
}

/**
 * Carrera del día: fotos minuto a minuto desde las 9:30 ET (o desde la primera
 * barra de hoy si aún no ha abierto) hasta la última barra, medidas contra el
 * cierre regular anterior de cada ticker.
 */
export function dayRaceFrames(barsByTicker: Record<string, Bar[]>): Race {
  const sorted = Object.fromEntries(
    Object.entries(barsByTicker).map(([ticker, bars]) => [ticker, [...bars].sort((a, b) => a.t - b.t)])
  );

  const end = Math.max(0, ...Object.values(sorted).map((bars) => bars[bars.length - 1]?.t ?? 0));
  if (end === 0) {
    return { frames: [], lanes: Object.keys(sorted).map((ticker) => ({ ticker, price: null, path: [] })) };
  }

  const dayStart = etDayStart(end);
  const [year, month, day] = etParts(end / 1000).date.split('-').map(Number);
  const open = etWallClockToEpoch(year, month, day, 9, 30) * 1000;
  const firstToday = Math.min(
    ...Object.values(sorted).flatMap((bars) => bars.filter((bar) => bar.t >= dayStart).slice(0, 1).map((bar) => bar.t))
  );
  const start = end >= open ? open : firstToday;

  const frames: number[] = [];
  for (let time = start; time <= end; time += MINUTE) frames.push(time);
  // La última barra no siempre cae en un minuto exacto desde la salida.
  if (frames[frames.length - 1] !== end) frames.push(end);

  const lanes = Object.entries(sorted).map(([ticker, bars]): RaceLane => {
    const prevClose = previousRegularClose(bars, dayStart);
    const path = frames.map((time) => {
      const close = closeAtOrBefore(bars, time);
      return prevClose && close ? (close / prevClose - 1) * 100 : null;
    });
    return { ticker, price: bars[bars.length - 1]?.c ?? null, path };
  });

  return { frames, lanes };
}

/** Orden de los carriles en la foto `frame`: el que más sube arriba, los que no tienen dato abajo. */
export function rankAt(lanes: RaceLane[], frame: number): string[] {
  return [...lanes]
    .sort((a, b) => (b.path[frame] ?? -Infinity) - (a.path[frame] ?? -Infinity))
    .map((lane) => lane.ticker);
}

/** Escala fija para toda la carrera: los coches no cambian de escala mientras corren. */
export function raceScale(lanes: RaceLane[]): number {
  const moves = lanes.flatMap((lane) => lane.path).filter((value): value is number => value !== null);
  return Math.max(MIN_SCALE, ...moves.map(Math.abs));
}

/** Lista escrita a mano: «mu, skhy sndk» -> ['MU', 'SKHY', 'SNDK']. */
export function parseTickerList(text: string): string[] {
  const tickers = text
    .toUpperCase()
    .split(/[\s,;]+/)
    .filter((ticker) => ticker && isValidTicker(ticker));
  return Array.from(new Set(tickers)).slice(0, MAX_RACE_TICKERS);
}
