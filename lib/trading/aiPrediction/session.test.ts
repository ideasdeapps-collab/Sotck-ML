import { describe, expect, it } from 'vitest';
import { STEP_MS, etHHMM, sessionWindow } from './session';

// Lunes 12-oct-2026, EDT (UTC-4): 9:30 ET = 13:30 UTC, 16:00 ET = 20:00 UTC.
const at = (hour: number, minute: number) => Date.UTC(2026, 9, 12, hour + 4, minute);

describe('sessionWindow', () => {
  it('cada 5 min desde la última barra hasta las 16:00 ET', () => {
    const window = sessionWindow(at(10, 20), at(10, 3));
    if (typeof window === 'string') throw new Error(window);

    expect(window.sessionDate).toBe('2026-10-12');
    expect(etHHMM(window.targets[0])).toBe('10:05');
    expect(etHHMM(window.targets[window.targets.length - 1])).toBe('16:00');
    expect(window.targets[1] - window.targets[0]).toBe(STEP_MS);
    expect(window.targets).toHaveLength(72);
  });

  it('antes de la apertura empieza a las 9:35', () => {
    const window = sessionWindow(at(8, 0), at(7, 40));
    if (typeof window === 'string') throw new Error(window);
    expect(etHHMM(window.targets[0])).toBe('09:35');
    expect(window.targets).toHaveLength(78);
  });

  it('después del cierre o en fin de semana no hay sesión', () => {
    expect(sessionWindow(at(16, 1), at(15, 59))).toMatch(/cerró/);
    expect(sessionWindow(Date.UTC(2026, 9, 10, 15, 0), null)).toMatch(/fin de semana/);
  });
});
