import { crossedDown, crossedUp } from '../dayTrading/planAlerts';
import { planTrade } from '../dayTrading/positionSize';
import type { IntradayPlan, PlanCheck, PlanDirection } from '../dayTrading/intradayPlan';
import type { WickSetup } from '../priceAction/wickZones';
import type { Position } from '../paperEngine';
import type { CopilotSetups } from './setups';
import type { CopilotClose, CopilotDecision, CopilotProposal, CopilotSource } from './types';

/**
 * Qué haría el copiloto ahora mismo. Función pura: no abre nada, no cierra
 * nada y no toca el store — devuelve la decisión y deja que `engine.ts` la
 * ejecute. Eso es lo que la hace comprobable con un test en lugar de con una
 * sesión de mercado.
 *
 * No reimplementa nada: los cruces de nivel salen de `dayTrading/planAlerts`
 * (los mismos que resuelven el diario de sesión) y el tamaño y la aprobación
 * por R:R salen de `dayTrading/positionSize`.
 *
 * ⚠️ Guía educativa basada en reglas sobre una cuenta simulada, NO una
 * recomendación de inversión.
 */

export type PolicyInput = {
  ticker: string;
  timeframe: string;
  setups: CopilotSetups;
  /** Posición del copiloto en este ticker, si la hay. */
  position: Position | null;
  /** Último precio observado y el anterior: entre ambos se buscan los cruces. */
  price: number;
  previousPrice: number;
  capital: number;
  riskPerTrade: number;
  /** Efectivo de la cuenta simulada: acota el tamaño que el riesgo permite. */
  balance: number;
};

/** Un setup, mirado sin saber de qué estrategia viene. */
type Candidate = {
  source: CopilotSource;
  direction: PlanDirection;
  entryType: string;
  entry: [number, number];
  entryMid: number;
  stopLoss: number;
  takeProfit: [number, number];
  riskReward: number;
  lastPrice: number;
  checklist: PlanCheck[];
  rationale: string;
};

function fromPlan(plan: IntradayPlan): Candidate {
  return { source: 'plan', ...pick(plan) };
}

function fromWick(setup: WickSetup): Candidate {
  return { source: 'wick', ...pick(setup) };
}

function pick(setup: IntradayPlan | WickSetup): Omit<Candidate, 'source'> {
  return {
    direction: setup.direction,
    entryType: setup.entryType,
    entry: setup.entry,
    entryMid: setup.entryMid,
    stopLoss: setup.stopLoss,
    takeProfit: setup.takeProfit,
    riskReward: setup.riskReward,
    lastPrice: setup.lastPrice,
    checklist: setup.checklist,
    rationale: setup.rationale,
  };
}

/**
 * Identidad del setup. Redondeada a dos decimales a propósito: mientras los
 * niveles no se muevan es la misma operación, aunque el precio siga llegando
 * cada 15 s — y el veredicto de GPT se cachea contra este hash.
 */
export function setupHash(candidate: Pick<Candidate, 'source' | 'direction' | 'entryMid' | 'stopLoss' | 'takeProfit'>): string {
  return [
    candidate.source,
    candidate.direction,
    candidate.entryMid.toFixed(2),
    candidate.stopLoss.toFixed(2),
    candidate.takeProfit[0].toFixed(2),
  ].join('|');
}

/**
 * Elige el setup a vigilar.
 *
 * Una zona de mecha `active` significa que el precio está *ahora* dentro de la
 * zona de rechazo: es un evento, no una previsión, y por eso manda sobre el
 * plan intradía, que describe la sesión entera.
 */
export function chooseCandidate(setups: CopilotSetups): Candidate | null {
  if (setups.wick && setups.wick.zone.status === 'active') return fromWick(setups.wick);
  if (setups.plan) return fromPlan(setups.plan);
  if (setups.wick) return fromWick(setups.wick);
  return null;
}

/** Contexto de Elliott como texto, para el registro y para el prompt de GPT. */
function elliottReason(setups: CopilotSetups, direction: PlanDirection): string | null {
  const elliott = setups.elliott;
  if (!elliott) return null;

  const aligned = elliott.direction === direction;
  const sense = elliott.direction === 'long' ? 'alcista' : 'bajista';

  return `Elliott ${elliott.probability}% ${sense} (${elliott.state}) — ${aligned ? 'a favor' : 'en contra'} del setup`;
}

export function decide(input: PolicyInput): CopilotDecision {
  const { setups, position, price, previousPrice } = input;

  if (!Number.isFinite(price) || price <= 0) return { kind: 'idle', reasons: ['Sin precio válido'] };

  // --- Cerrar manda sobre abrir --------------------------------------------
  if (position) {
    const close = resolvePosition(position, previousPrice, price);
    if (close) return { kind: 'close', close };
    return { kind: 'idle', reasons: ['Posición abierta — gestionando stop y objetivo'] };
  }

  const candidate = chooseCandidate(setups);
  if (!candidate) return { kind: 'idle', reasons: ['Sin setup operativo — falta estructura'] };

  // --- No perseguir el precio ----------------------------------------------
  const [low, high] = candidate.entry;
  if (price < low || price > high) {
    return {
      kind: 'idle',
      reasons: [
        `Precio ${price.toFixed(2)} fuera de la zona de entrada ${low.toFixed(2)}–${high.toFixed(2)}`,
      ],
    };
  }

  // --- Tamaño y aprobación por riesgo, con las reglas que ya existen -------
  const sizing = planTrade(
    candidate.entryMid,
    candidate.stopLoss,
    candidate.takeProfit[0],
    input.capital,
    input.riskPerTrade
  );

  if (!sizing.approved) {
    return { kind: 'idle', reasons: [sizing.reason ?? 'Operación no aprobada por gestión de riesgo'] };
  }

  /*
   * El tamaño por riesgo no sabe nada del efectivo disponible, y en intradía
   * eso importa: con un stop a 0.6 $ de la entrada, arriesgar el 1% de 100 000
   * son 1 600 acciones — más de 170 000 $ de nocional. Recortar al efectivo
   * siempre reduce el riesgo por debajo del objetivo, nunca lo aumenta, así que
   * es preferible a no operar.
   */
  const affordable = Math.floor(input.balance / candidate.entryMid);
  const shares = Math.min(sizing.shares, affordable);

  if (shares < 1) {
    return {
      kind: 'idle',
      reasons: [`Efectivo insuficiente para una acción a ${candidate.entryMid.toFixed(2)}`],
    };
  }

  const riskAmount = shares * sizing.riskPerShare;

  const reasons = [
    `${candidate.source === 'wick' ? 'Mechas' : 'Plan intradía'} · ${candidate.entryType}`,
    candidate.rationale,
    `R:R ${sizing.riskReward} · ${shares} acciones · riesgo ${riskAmount.toFixed(2)}`,
    ...candidate.checklist.map((check) => `${check.ok ? '✓' : '✗'} ${check.label}: ${check.detail}`),
  ];

  if (shares < sizing.shares) {
    reasons.push(
      `Tamaño recortado por efectivo: ${shares} de las ${sizing.shares} que permitiría el riesgo`
    );
  }

  const elliott = elliottReason(setups, candidate.direction);
  if (elliott) reasons.push(elliott);

  const proposal: CopilotProposal = {
    ticker: input.ticker,
    timeframe: input.timeframe,
    source: candidate.source,
    direction: candidate.direction,
    entryType: candidate.entryType,
    entry: candidate.entry,
    entryMid: candidate.entryMid,
    stopLoss: candidate.stopLoss,
    takeProfit: candidate.takeProfit,
    riskReward: sizing.riskReward,
    lastPrice: price,
    shares,
    riskAmount,
    checklist: candidate.checklist,
    reasons,
    hash: setupHash(candidate),
  };

  return { kind: 'open', proposal };
}

/**
 * ¿El movimiento entre `previousPrice` y `price` resolvió la posición?
 *
 * El segundo objetivo gana al primero cuando un solo movimiento atraviesa los
 * dos: es el mejor precio que la operación llegó a ver, y es el mismo criterio
 * que aplica `journal.resolveOpenEntries`.
 */
export function resolvePosition(
  position: Position,
  previousPrice: number,
  price: number
): CopilotClose | null {
  if (!Number.isFinite(previousPrice) || previousPrice === price) return null;

  const long = position.side === 'long';
  const reached = (level: number) =>
    long ? crossedUp(previousPrice, price, level) : crossedDown(previousPrice, price, level);
  const stopped = long
    ? crossedDown(previousPrice, price, position.stop)
    : crossedUp(previousPrice, price, position.stop);

  if (position.target2 !== undefined && reached(position.target2)) {
    return {
      positionId: position.id,
      ticker: position.ticker,
      price: position.target2,
      outcome: 'tp2',
      reason: `Take Profit 2 alcanzado en ${position.target2.toFixed(2)}`,
    };
  }

  if (reached(position.target)) {
    return {
      positionId: position.id,
      ticker: position.ticker,
      price: position.target,
      outcome: 'tp1',
      reason: `Take Profit 1 alcanzado en ${position.target.toFixed(2)}`,
    };
  }

  if (stopped) {
    return {
      positionId: position.id,
      ticker: position.ticker,
      price: position.stop,
      outcome: 'stop',
      reason: `Stop loss alcanzado en ${position.stop.toFixed(2)}`,
    };
  }

  return null;
}
