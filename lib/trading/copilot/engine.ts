'use client';

import { closePosition, getPortfolio, openPosition, positionsOf } from '../paperEngine';
import { recordPlan, resolveOpenEntries } from '../dayTrading/journal';
import type { PlanBias } from '../dayTrading/intradayPlan';
import type { Indicators } from '../indicators';
import type { Candle } from '../marketData';
import { collectSetups } from './setups';
import { decide } from './policy';
import { check, dailyLossReached } from './guardrails';
import { askVerdict, buildBrief } from './llm';
import { copilot, getCopilotState } from './store';
import type { CopilotProposal } from './types';
import type { IntradayResponse } from '@/types/trading';

/**
 * El bucle del copiloto.
 *
 * No tiene temporizador propio: el reloj es el stream de velas, que el panel le
 * pasa en cada refresco. Un `setInterval` paralelo se desincronizaría con los
 * datos y actuaría sobre precios que el usuario no está viendo.
 *
 * Todo lo que decide sale de funciones puras (`policy`, `guardrails`); aquí solo
 * se ejecuta, se registra y se anota en el diario.
 */

export type TickContext = {
  ticker: string;
  timeframe: string;
  candles: Candle[];
  indicators: Indicators;
  intraday: IntradayResponse | null;
  bias: PlanBias;
  /** `polygon` | `polygon-cached` | `polygon-stale` | `demo`. */
  dataSource: string;
  capital: number;
  riskPerTrade: number;
  /** Precio del tick anterior; entre ese y el actual se buscan los cruces. */
  previousPrice: number;
};

/**
 * Un tick puede quedarse esperando a GPT mientras llega la vela siguiente.
 * Sin este cerrojo, dos ticks solapados abrirían la misma operación dos veces.
 */
let running = false;

export function isRunning(): boolean {
  return running;
}

export async function runTick(context: TickContext): Promise<void> {
  if (running) return;

  const state = getCopilotState();
  if (!state.enabled) return;

  const last = context.candles[context.candles.length - 1];
  if (!last) return;

  const price = last.close;
  if (!Number.isFinite(price) || price <= 0) return;

  running = true;

  try {
    // El diario resuelve sus propias entradas contra el precio nuevo — así una
    // operación del copiloto se cierra en el diario aunque el panel del plan no
    // esté montado.
    resolveOpenEntries(context.ticker, price);

    // El tope de pérdida diaria no bloquea una operación: apaga el copiloto.
    if (
      dailyLossReached({
        realisedToday: state.realisedToday,
        capital: context.capital,
        config: state.config,
      })
    ) {
      copilot.setEnabled(false);
      copilot.log({
        ticker: context.ticker,
        kind: 'error',
        headline: 'Copiloto apagado',
        reasons: [
          `Pérdida máxima diaria alcanzada (${(context.capital * state.config.maxDailyLossPct).toFixed(2)})`,
        ],
      });
      return;
    }

    const position = positionsOf('copilot', context.ticker)[0] ?? null;
    const { balance } = getPortfolio();

    const setups = collectSetups({
      candles: context.candles,
      indicators: context.indicators,
      intraday: context.intraday,
      bias: context.bias,
    });

    const decision = decide({
      ticker: context.ticker,
      timeframe: context.timeframe,
      setups,
      position,
      price,
      previousPrice: context.previousPrice,
      capital: context.capital,
      riskPerTrade: context.riskPerTrade,
      balance,
    });

    if (decision.kind === 'idle') {
      copilot.log({
        ticker: context.ticker,
        kind: 'blocked',
        headline: 'Sin operación',
        reasons: decision.reasons,
      });
      return;
    }

    if (decision.kind === 'close') {
      const { close } = decision;
      const pnl = closePosition(close.ticker, close.price, close.positionId);

      if (pnl === null) {
        copilot.log({
          ticker: close.ticker,
          kind: 'error',
          headline: 'No se pudo cerrar la posición',
          reasons: [close.reason],
        });
        return;
      }

      copilot.settle(pnl, close.outcome === 'stop');
      copilot.log({
        ticker: close.ticker,
        candleTime: last.time,
        kind: 'close',
        headline: `Cerrada a ${close.price.toFixed(2)} · ${close.outcome.toUpperCase()}`,
        reasons: [close.reason],
        pnl,
      });
      return;
    }

    await tryOpen(decision.proposal, setups, context, state);
  } finally {
    running = false;
  }
}

async function tryOpen(
  proposal: CopilotProposal,
  setups: ReturnType<typeof collectSetups>,
  context: TickContext,
  state: ReturnType<typeof getCopilotState>
): Promise<void> {
  const portfolio = getPortfolio();
  const last = context.candles[context.candles.length - 1];

  const blockers = check(proposal, {
    config: state.config,
    dataSource: context.dataSource,
    candleTime: last.time,
    balance: portfolio.balance,
    hasOpenPosition: positionsOf('copilot', proposal.ticker).length > 0,
    tradesToday: state.tradesToday,
    realisedToday: state.realisedToday,
    capital: context.capital,
    lastStopAt: state.lastStopAt,
    now: Date.now(),
  });

  if (blockers.length > 0) {
    copilot.log({
      ticker: proposal.ticker,
      kind: 'blocked',
      headline: 'Operación bloqueada',
      reasons: blockers,
    });
    return;
  }

  // --- Veredicto de GPT, si está activado ---------------------------------
  let verdict = undefined;

  if (state.config.useLlm) {
    const brief = buildBrief({
      proposal,
      candles: context.candles,
      indicators: context.indicators,
      setups,
      capital: context.capital,
      balance: portfolio.balance,
      tradesToday: state.tradesToday,
      realisedToday: state.realisedToday,
    });

    const result = await askVerdict(proposal.hash, brief);

    if (result.ok) {
      verdict = result.data;

      if (verdict.verdict !== 'approve') {
        copilot.log({
          ticker: proposal.ticker,
          kind: 'skip',
          headline: verdict.verdict === 'reject' ? 'GPT rechaza la operación' : 'GPT prefiere esperar',
          reasons: proposal.reasons,
          llm: verdict,
        });
        return;
      }

      if (verdict.confidence < state.config.minLlmConfidence) {
        copilot.log({
          ticker: proposal.ticker,
          kind: 'skip',
          headline: `Confianza ${verdict.confidence}% por debajo del mínimo (${state.config.minLlmConfidence}%)`,
          reasons: proposal.reasons,
          llm: verdict,
        });
        return;
      }
    } else {
      // GPT no disponible o en espera: las reglas mandan y queda anotado por qué.
      proposal.reasons.push(`Sin veredicto de GPT — ${result.reason}`);
    }
  }

  // --- Ejecutar ------------------------------------------------------------
  const opened = openPosition({
    ticker: proposal.ticker,
    shares: proposal.shares,
    entry: proposal.entryMid,
    stop: proposal.stopLoss,
    target: proposal.takeProfit[0],
    target2: proposal.takeProfit[1],
    side: proposal.direction,
    owner: 'copilot',
  });

  if (!opened) {
    copilot.log({
      ticker: proposal.ticker,
      kind: 'error',
      headline: 'La cuenta rechazó la orden',
      reasons: ['Saldo insuficiente en el momento de ejecutar'],
    });
    return;
  }

  // El mismo diario de sesión que usan el plan intradía y las mechas.
  recordPlan(proposal, {
    ticker: proposal.ticker,
    timeframe: proposal.timeframe,
    shares: proposal.shares,
    riskAmount: proposal.riskAmount,
  });

  copilot.countTrade();
  copilot.log({
    ticker: proposal.ticker,
    candleTime: last.time,
    kind: 'open',
    headline: `${proposal.direction === 'long' ? 'COMPRA' : 'VENTA'} ${proposal.shares} @ ${proposal.entryMid.toFixed(2)}`,
    reasons: proposal.reasons,
    llm: verdict,
    levels: {
      entry: proposal.entryMid,
      stopLoss: proposal.stopLoss,
      takeProfit: proposal.takeProfit[0],
      shares: proposal.shares,
      direction: proposal.direction,
    },
  });
}

/**
 * Cierre de emergencia: saca solo lo que abrió el copiloto, al precio que se le
 * pase por ticker. Un símbolo sin precio se queda abierto — cerrarlo a un
 * precio inventado sería peor que dejarlo.
 */
export function closeAllCopilotPositions(prices: Record<string, number>): number {
  let realised = 0;

  for (const position of positionsOf('copilot')) {
    const price = prices[position.ticker];
    if (!Number.isFinite(price) || price <= 0) continue;

    const pnl = closePosition(position.ticker, price, position.id);
    if (pnl === null) continue;

    realised += pnl;
    copilot.settle(pnl, false);
    copilot.log({
      ticker: position.ticker,
      kind: 'close',
      headline: `Cierre manual a ${price.toFixed(2)}`,
      reasons: ['Interruptor de emergencia del copiloto'],
      pnl,
    });
  }

  return realised;
}
