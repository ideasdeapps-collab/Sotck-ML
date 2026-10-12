import { etParts, etWallClockToEpoch } from '../chartTime';

/**
 * Las horas que tiene que predecir la IA: cada 5 min desde la última barra
 * conocida hasta el cierre regular (16:00 ET) de hoy.
 */

export const STEP_MS = 5 * 60_000;

/** «HH:MM» en hora de Nueva York. */
export function etHHMM(ms: number): string {
  const { hour, minute } = etParts(ms / 1000);
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export type SessionWindow = { sessionDate: string; open: number; close: number; targets: number[] };

/**
 * `from` es el cierre de la última barra de Polygon (epoch ms). Antes de la
 * apertura, la proyección empieza a las 9:35; después del cierre o en fin de
 * semana no hay sesión que predecir y devuelve el motivo.
 */
export function sessionWindow(now: number, from: number | null): SessionWindow | string {
  const { date } = etParts(now / 1000);
  const [year, month, day] = date.split('-').map(Number);

  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  if (weekday === 0 || weekday === 6) return 'Hoy no hay sesión (fin de semana)';

  const open = etWallClockToEpoch(year, month, day, 9, 30) * 1000;
  const close = etWallClockToEpoch(year, month, day, 16, 0) * 1000;
  if (now >= close) return 'La sesión regular ya cerró (16:00 ET); genera la predicción durante la sesión o antes de la apertura';

  const start = Math.max(open, from ?? 0);
  if (start >= close) return 'La última barra ya es del cierre: no queda sesión que predecir';

  // Los husos de ET son horas enteras, así que los múltiplos de 5 min en UTC lo son también en ET.
  const targets: number[] = [];
  for (let t = Math.floor(start / STEP_MS) * STEP_MS + STEP_MS; t <= close; t += STEP_MS) targets.push(t);

  return { sessionDate: date, open, close, targets };
}
