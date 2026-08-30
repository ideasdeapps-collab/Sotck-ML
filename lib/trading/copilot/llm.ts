import { fetchJson } from '../fetchJson';
import type { Indicators } from '../indicators';
import type { Candle } from '../marketData';
import type { CopilotSetups } from './setups';
import type { CopilotProposal, LlmVerdict } from './types';
import type { MlResult } from '@/types/trading';

/**
 * Cliente del veredicto de GPT.
 *
 * Nunca rechaza: devuelve `MlResult`, igual que `mlApi.ts`, porque un fallo de
 * OpenAI tiene que degradar el copiloto a modo solo-reglas, no tumbarlo.
 *
 * Aquí vive el control de coste, que es la parte fácil de romper: el gráfico
 * refresca cada 15 s, así que preguntar por tick serían unas 5 700 llamadas al
 * día por una sesión abierta. Se pregunta una vez por setup — mientras los
 * niveles no se muevan es la misma operación — y con un mínimo entre llamadas
 * y un tope por sesión como red.
 */

const MIN_INTERVAL_MS = 60_000;
const MAX_CALLS_PER_SESSION = 40;

/** Veredictos ya emitidos, por hash de setup. */
const verdicts = new Map<string, LlmVerdict>();
let lastCallAt = 0;
let calls = 0;

/** Qué se le manda al modelo: números, no velas. */
export type SetupBrief = ReturnType<typeof buildBrief>;

const round = (value: number, digits = 2) =>
  Number.isFinite(value) ? Number(value.toFixed(digits)) : null;

function lastFinite(values: number[]): number | null {
  for (let i = values.length - 1; i >= 0; i--) {
    if (Number.isFinite(values[i])) return values[i];
  }
  return null;
}

/**
 * Resumen compacto del setup y su contexto.
 *
 * Deliberadamente sin velas crudas: 500 OHLCV son miles de tokens por llamada
 * y no le dicen al modelo nada que los indicadores ya calculados no digan mejor.
 */
export function buildBrief(input: {
  proposal: CopilotProposal;
  candles: Candle[];
  indicators: Indicators;
  setups: CopilotSetups;
  capital: number;
  balance: number;
  tradesToday: number;
  realisedToday: number;
}) {
  const { proposal, indicators, candles } = input;
  const last = candles[candles.length - 1];
  const price = last?.close ?? proposal.lastPrice;

  const rsi = lastFinite(indicators.rsi14);
  const atr = lastFinite(indicators.atr14);
  const vwap = lastFinite(indicators.vwap);
  const ema20 = lastFinite(indicators.ema20);
  const ema50 = lastFinite(indicators.ema50);

  const recent = candles.slice(-20);
  const avgVolume = recent.length
    ? recent.reduce((total, candle) => total + candle.volume, 0) / recent.length
    : 0;

  return {
    ticker: proposal.ticker,
    timeframe: proposal.timeframe,
    estrategia: proposal.source === 'wick' ? 'zonas de rechazo (mechas)' : 'plan intradía S/R',
    operacion: {
      direccion: proposal.direction === 'long' ? 'compra' : 'venta en corto',
      tipo_entrada: proposal.entryType,
      zona_entrada: [round(proposal.entry[0]), round(proposal.entry[1])],
      stop_loss: round(proposal.stopLoss),
      objetivos: [round(proposal.takeProfit[0]), round(proposal.takeProfit[1])],
      riesgo_beneficio: proposal.riskReward,
      acciones: proposal.shares,
      riesgo_dinero: round(proposal.riskAmount),
    },
    contexto: {
      precio: round(price),
      rsi14: round(rsi ?? NaN),
      atr14: round(atr ?? NaN),
      vs_vwap: vwap ? round(((price - vwap) / vwap) * 100) : null,
      ema20_sobre_ema50: ema20 !== null && ema50 !== null ? ema20 > ema50 : null,
      volumen_ultima_vs_media20: avgVolume ? round((last?.volume ?? 0) / avgVolume) : null,
      checklist: proposal.checklist.map((check) => ({ criterio: check.label, cumple: check.ok, detalle: check.detail })),
      elliott: input.setups.elliott
        ? {
            probabilidad_inicio_impulso: input.setups.elliott.probability,
            sentido: input.setups.elliott.direction === 'long' ? 'alcista' : 'bajista',
            estado: input.setups.elliott.state,
          }
        : null,
    },
    cuenta: {
      capital: round(input.capital),
      efectivo: round(input.balance),
      operaciones_hoy: input.tradesToday,
      resultado_hoy: round(input.realisedToday),
    },
  };
}

/** Motivo por el que no se consultó, o null si toca consultar. */
function throttleReason(hash: string, now: number): string | null {
  if (verdicts.has(hash)) return null;
  if (calls >= MAX_CALLS_PER_SESSION) return `Tope de ${MAX_CALLS_PER_SESSION} consultas a GPT en esta sesión`;
  if (now - lastCallAt < MIN_INTERVAL_MS) {
    return `Esperando ${Math.ceil((MIN_INTERVAL_MS - (now - lastCallAt)) / 1000)} s antes de volver a consultar a GPT`;
  }
  return null;
}

export async function askVerdict(
  hash: string,
  brief: SetupBrief,
  now = Date.now()
): Promise<MlResult<LlmVerdict>> {
  const cached = verdicts.get(hash);
  if (cached) return { ok: true, data: cached };

  const throttled = throttleReason(hash, now);
  if (throttled) return { ok: false, reason: throttled };

  lastCallAt = now;
  calls += 1;

  try {
    const payload = await fetchJson('/api/copilot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash, setup: brief }),
    });

    if (payload?.unavailable) return { ok: false, reason: String(payload.reason || 'GPT no disponible') };

    const verdict: LlmVerdict = {
      verdict: payload.verdict,
      confidence: Number(payload.confidence) || 0,
      rationale: String(payload.rationale || ''),
      risks: Array.isArray(payload.risks) ? payload.risks.map(String) : [],
    };

    if (!['approve', 'reject', 'wait'].includes(verdict.verdict)) {
      return { ok: false, reason: 'GPT devolvió un veredicto no reconocido' };
    }

    verdicts.set(hash, verdict);
    return { ok: true, data: verdict };
  } catch (error: any) {
    return { ok: false, reason: error?.message || 'No se pudo consultar a GPT' };
  }
}

/** Cuántas consultas lleva la sesión — el panel lo muestra. */
export function llmUsage() {
  return { calls, max: MAX_CALLS_PER_SESSION };
}
