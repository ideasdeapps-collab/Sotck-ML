import { buildIntradayPlan, zonesFromChartism, type IntradayPlan, type PlanBias } from '../dayTrading/intradayPlan';
import { buildWickSetup, detectWickZones, type WickSetup } from '../priceAction/wickZones';
import { elliottProbabilitySeries, type ElliottCandidate } from '../priceAction/elliottStart';
import type { Candle } from '../marketData';
import type { Indicators } from '../indicators';
import type { IntradayResponse } from '@/types/trading';

/**
 * Reúne los candidatos operativos que el Lab ya sabe construir.
 *
 * Aquí no hay lógica de decisión: solo llama a las mismas funciones puras que
 * pintan los overlays y alimentan los paneles, para que el copiloto no pueda
 * operar una cosa distinta de la que el usuario está viendo en pantalla.
 */

export type CopilotSetups = {
  plan: IntradayPlan | null;
  wick: WickSetup | null;
  /** No genera operaciones: modula la confianza y entra como razón. */
  elliott: ElliottCandidate | null;
};

export type SetupsInput = {
  candles: Candle[];
  indicators: Indicators;
  /** Respuesta de `/intraday`; sin ella no hay S/R y no hay plan. */
  intraday: IntradayResponse | null;
  bias: PlanBias;
};

export function collectSetups({ candles, indicators, intraday, bias }: SetupsInput): CopilotSetups {
  if (candles.length === 0) return { plan: null, wick: null, elliott: null };

  const zones = intraday ? zonesFromChartism(intraday.chartism) : [];

  const plan =
    zones.length > 0
      ? buildIntradayPlan({
          candles,
          indicators,
          zones,
          trend: intraday?.chartism?.structure?.trend,
          bias,
        })
      : null;

  const wick = buildWickSetup(detectWickZones({ candles, indicators }), { candles, indicators });
  const { current } = elliottProbabilitySeries({ candles, indicators });

  return { plan, wick, elliott: current };
}
