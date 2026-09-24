import type { OneMinuteSignalBundle, OneMinuteSignalHorizon, OneMinuteSignalScore } from '@/types/trading';

/**
 * Leyenda de la señal de dirección de 1 min.
 *
 * Lo que cambia cómo se lee cada número va en el propio texto: si el horizonte
 * demostró ventaja fuera de muestra, si el modelo se abstiene y cuánto acierta
 * en vivo. Una probabilidad sin eso invita a leer certeza donde no la hay.
 */

const pct = (x: number) => `${Math.round(x * 100)}%`;

function horizonText(h: OneMinuteSignalHorizon): string {
  if (!h.available) return `${h.h}m — fuera de sesión`;
  const arrow = h.direction === 'up' ? '↑' : '↓';
  const prob = pct(h.direction === 'up' ? h.p_up : 1 - h.p_up);
  const reading = !h.has_edge
    ? 'sin ventaja demostrada'
    : h.confident
      ? `confiado · ${h.oos_precision != null ? pct(h.oos_precision) : '—'} fuera de muestra`
      : 'se abstiene';
  return `${h.h}m ${arrow} ${prob} (${reading})`;
}

function liveText(score: OneMinuteSignalScore | null): string {
  const parts = Object.entries(score?.horizons ?? {})
    .filter(([, s]) => s.resolved > 0)
    .map(([h, s]) => {
      const conf = s.acc_confident != null ? `${pct(s.acc_confident)} confiado` : 'sin confiadas';
      const all = s.acc_all != null ? `${pct(s.acc_all)} total` : '—';
      return `${h}m: ${conf} · ${all} (n=${s.resolved})`;
    });
  return parts.length ? `en vivo ${parts.join(', ')}` : 'sin histórico en vivo';
}

export function signalLegend({ signal, score }: OneMinuteSignalBundle): string {
  const hora = new Date(signal.as_of).toLocaleTimeString('es-ES', {
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });
  return (
    `Señal ML 1m · última barra ${hora} ET · ${signal.horizons.map(horizonText).join(' · ')} · ` +
    `${liveText(score)} — datos con ~15 min de retraso (plan Starter); contexto, no señal de entrada`
  );
}
