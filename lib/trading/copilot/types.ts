import type { PlanCheck, PlanDirection } from '../dayTrading/intradayPlan';

/**
 * Vocabulario compartido del copiloto.
 *
 * Vive aparte del store para que las funciones puras (`policy`, `guardrails`)
 * y el cliente del LLM puedan tipar sus entradas sin arrastrar estado de React
 * ni `localStorage` — que es justo lo que las hace testeables.
 */

/** De qué estrategia del Lab sale la operación. */
export type CopilotSource = 'plan' | 'wick';

/**
 * Una operación lista para ejecutarse: niveles, tamaño y por qué.
 *
 * Satisface estructuralmente el `RecordablePlan` de `dayTrading/journal.ts`, así
 * que se guarda en el diario de sesión con la misma maquinaria que el plan
 * intradía y el setup de mechas, sin que el diario sepa que el copiloto existe.
 */
export type CopilotProposal = {
  ticker: string;
  timeframe: string;
  source: CopilotSource;
  direction: PlanDirection;
  entryType: string;
  entry: [number, number];
  entryMid: number;
  stopLoss: number;
  takeProfit: [number, number];
  riskReward: number;
  lastPrice: number;
  shares: number;
  riskAmount: number;
  checklist: PlanCheck[];
  reasons: string[];
  /**
   * Identidad estable del setup. El gating de coste del LLM se apoya en esto:
   * mientras los niveles no se muevan es la misma operación, por mucho que el
   * precio siga refrescándose cada 15 s.
   */
  hash: string;
};

export type CopilotOutcome = 'tp1' | 'tp2' | 'stop';

/** Un cierre pendiente de ejecutar, ya resuelto contra el precio. */
export type CopilotClose = {
  positionId: string;
  ticker: string;
  price: number;
  outcome: CopilotOutcome;
  reason: string;
};

/**
 * Lo que la política decide en un tick. Cerrar manda sobre abrir: una posición
 * que ya tocó su stop no puede seguir viva mientras se evalúa una entrada nueva.
 */
export type CopilotDecision =
  | { kind: 'close'; close: CopilotClose }
  | { kind: 'open'; proposal: CopilotProposal }
  | { kind: 'idle'; reasons: string[] };

/** Veredicto de GPT. Nunca trae precios: solo juzga los que ya calcularon las reglas. */
export type LlmVerdict = {
  verdict: 'approve' | 'reject' | 'wait';
  confidence: number;
  rationale: string;
  risks: string[];
};

export type CopilotConfig = {
  maxTradesPerDay: number;
  /** Fracción del capital que, perdida en el día, apaga el copiloto. */
  maxDailyLossPct: number;
  cooldownMinutes: number;
  useLlm: boolean;
  minLlmConfidence: number;
};

export type CopilotEventKind = 'open' | 'close' | 'skip' | 'blocked' | 'error';

export type CopilotEvent = {
  id: string;
  at: number;
  /** Vela sobre la que se actuó, en epoch de segundos — el gráfico marca ahí. */
  candleTime?: number;
  ticker: string;
  kind: CopilotEventKind;
  headline: string;
  reasons: string[];
  llm?: LlmVerdict;
  levels?: { entry: number; stopLoss: number; takeProfit: number; shares: number; direction: PlanDirection };
  pnl?: number;
};

export type CopilotState = {
  enabled: boolean;
  config: CopilotConfig;
  events: CopilotEvent[];
  /** Fecha ET de la sesión que cuentan `tradesToday` y `realisedToday`. */
  day: string;
  tradesToday: number;
  realisedToday: number;
  /** Epoch ms del último stop, para el cooldown. */
  lastStopAt: number | null;
};
