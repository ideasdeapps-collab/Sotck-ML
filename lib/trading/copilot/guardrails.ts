import { sessionOf } from '../chartTime';
import type { CopilotConfig, CopilotProposal } from './types';

/**
 * Lo que el copiloto no hace, pase lo que pase.
 *
 * Se evalúan SIEMPRE y al final: también cuando GPT ha aprobado la operación.
 * El modelo opina sobre la calidad del setup; estos límites son del usuario y
 * ninguna opinión los levanta.
 *
 * Función pura que devuelve los motivos de bloqueo. Vacío = adelante.
 */

export type GuardrailContext = {
  config: CopilotConfig;
  /** `polygon` | `polygon-cached` | `polygon-stale` | `demo` — de dónde salen las velas. */
  dataSource: string;
  /** Hora de la última vela, en epoch de segundos. */
  candleTime: number;
  /** Saldo disponible en la cuenta simulada. */
  balance: number;
  /** ¿Ya hay una posición del copiloto en este ticker? */
  hasOpenPosition: boolean;
  tradesToday: number;
  /** Resultado realizado hoy, en dinero. Negativo es pérdida. */
  realisedToday: number;
  capital: number;
  /** Epoch ms del último stop, o null si no hubo. */
  lastStopAt: number | null;
  now: number;
};

/** El límite de pérdida diaria no bloquea una operación: apaga el copiloto. */
export function dailyLossReached(context: Pick<GuardrailContext, 'realisedToday' | 'capital' | 'config'>): boolean {
  const limit = context.capital * context.config.maxDailyLossPct;
  return limit > 0 && context.realisedToday <= -limit;
}

export function check(proposal: CopilotProposal, context: GuardrailContext): string[] {
  const blockers: string[] = [];

  // Velas sintéticas: `marketData.buildDemoCandles` inventa la serie cuando no
  // hay POLYGON_API_KEY. Operar sobre ella produce un historial que no significa
  // nada, así que ni siquiera es una operación de práctica.
  if (context.dataSource === 'demo') {
    blockers.push('Velas simuladas — configura POLYGON_API_KEY para operar');
  }

  const session = sessionOf(context.candleTime);
  if (session !== 'regular') {
    blockers.push(
      session === 'premarket' ? 'Fuera de sesión: premarket' : 'Fuera de sesión: after-hours'
    );
  }

  if (context.hasOpenPosition) {
    blockers.push(`Ya hay una posición abierta en ${proposal.ticker}`);
  }

  if (context.tradesToday >= context.config.maxTradesPerDay) {
    blockers.push(`Tope de ${context.config.maxTradesPerDay} operaciones al día alcanzado`);
  }

  if (dailyLossReached(context)) {
    const limit = context.capital * context.config.maxDailyLossPct;
    blockers.push(`Pérdida máxima diaria alcanzada (${limit.toFixed(2)})`);
  }

  if (context.lastStopAt !== null) {
    const elapsed = context.now - context.lastStopAt;
    const cooldown = context.config.cooldownMinutes * 60_000;
    if (elapsed < cooldown) {
      const left = Math.ceil((cooldown - elapsed) / 60_000);
      blockers.push(`Enfriamiento tras un stop — ${left} min restantes`);
    }
  }

  if (proposal.shares < 1) {
    blockers.push('Tamaño calculado inferior a una acción');
  }

  if (proposal.shares * proposal.entryMid > context.balance) {
    blockers.push('Saldo insuficiente para el tamaño calculado');
  }

  return blockers;
}
