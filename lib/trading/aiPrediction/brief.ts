import type { Candle } from '../marketData';
import { calculateIndicators } from '../indicators';
import { calculateOpeningRange } from '../dayTrading/openingRange';
import { previousDayLevels } from '../dayTrading/sessions';
import { etParts } from '../chartTime';
import { AI_CHAIN } from '../aiEcosystem/chain';
import { linkAverage } from '../aiEcosystem/moves';
import type { EcosystemResponse } from '../aiEcosystem/server';
import type { LiveQuote } from '../liveQuote/sources';
import type { NewsReport } from '../newsAgent/types';
import { compactJson } from './compact';
import { etHHMM, type SessionWindow } from './session';
import { summarizeHorizons } from './score';
import type { AiPrediction } from './types';

/**
 * El contexto que recibe la IA: todo lo que la app ya calcula, compactado.
 * Puro: la recogida (red, cachés) vive en `server.ts`.
 */

export type BriefInput = {
  ticker: string;
  now: number;
  asOf: number;
  anchor: number;
  window: SessionWindow;
  candles5m: Candle[] | null;
  live: LiveQuote | null;
  news: NewsReport | null;
  ecosystem: EcosystemResponse | null;
  /** Respuestas de la API de ML, por endpoint. */
  ml: Record<string, unknown>;
  /** Predicciones anteriores de este ticker, con su resultado ya calculado. */
  history: AiPrediction[];
};

const round = (value: number | undefined | null, digits = 2) =>
  value === undefined || value === null || !Number.isFinite(value) ? null : Number(value.toFixed(digits));

const lastOf = (values: number[]) => round(values[values.length - 1]);

function candlesBlock(candles: Candle[], sessionDate: string) {
  const today = candles.filter((candle) => etParts(candle.time).date === sessionDate);
  const indicators = calculateIndicators(candles);
  const bands = indicators.vwapBands;
  const range = calculateOpeningRange(candles, 15);

  return {
    // [hora ET, apertura, máximo, mínimo, cierre, volumen]; incluye el premarket de hoy.
    velas_5m_hoy: today.slice(-100).map((candle) => [
      etHHMM(candle.time * 1000),
      round(candle.open),
      round(candle.high),
      round(candle.low),
      round(candle.close),
      Math.round(candle.volume),
    ]),
    indicadores_5m: {
      ema20: lastOf(indicators.ema20),
      ema50: lastOf(indicators.ema50),
      vwap: lastOf(bands.vwap),
      vwap_banda_sup_1: lastOf(bands.upper1),
      vwap_banda_inf_1: lastOf(bands.lower1),
      vwap_banda_sup_2: lastOf(bands.upper2),
      vwap_banda_inf_2: lastOf(bands.lower2),
      rsi14: lastOf(indicators.rsi14),
      atr14: round(indicators.atr14[indicators.atr14.length - 1], 3),
      bollinger_sup: lastOf(indicators.bollinger.upper),
      bollinger_inf: lastOf(indicators.bollinger.lower),
    },
    niveles: {
      dia_previo: previousDayLevels(candles),
      opening_range_15m:
        range && range.sessionDate === sessionDate
          ? { maximo: round(range.high), minimo: round(range.low), ruptura: range.breakout?.direction ?? null }
          : null,
    },
  };
}

function newsBlock(news: NewsReport) {
  return {
    ia: news.llm.ok
      ? { sentimiento: news.llm.score, emocion: news.llm.emotion, resumen: news.llm.summary, riesgos: news.llm.risks }
      : null,
    datos: compactJson(news.data),
    titulares: news.headlines.slice(0, 8).map((headline) => headline.title),
    macro: news.macro.slice(0, 4).map((headline) => headline.title),
  };
}

function ecosystemBlock(ecosystem: EcosystemResponse, ticker: string) {
  const own = ecosystem.moves[ticker];
  return {
    eslabones: AI_CHAIN.map((link) => ({
      eslabon: link.label,
      dia_pct: round(linkAverage(link.tickers.map((entry) => ecosystem.moves[entry.ticker]?.change1d ?? null))),
      m15_pct: round(linkAverage(link.tickers.map((entry) => ecosystem.moves[entry.ticker]?.change15m ?? null))),
    })),
    ticker_en_la_cadena: own ? { dia_pct: round(own.change1d), m15_pct: round(own.change15m), m5_pct: round(own.change5m) } : null,
  };
}

function historyBlock(history: AiPrediction[]) {
  const scored = history.filter((item) => item.score && item.score.evaluated > 0);
  const mean = (values: number[]) => (values.length ? round(values.reduce((a, b) => a + b, 0) / values.length, 3) : null);

  return {
    resumen: {
      predicciones_evaluadas: scored.length,
      error_medio_pct: mean(scored.map((item) => item.score!.maePct!).filter(Number.isFinite)),
      // Positivo = tus predicciones suelen quedar por encima de lo real.
      sesgo_medio_final_pct: mean(scored.map((item) => item.score!.endErrorPct!).filter(Number.isFinite)),
      acierto_direccion_pct: scored.length
        ? round((scored.filter((item) => item.score!.directionHit).length / scored.length) * 100, 0)
        : null,
      // Si tu error no es menor que el de «plano» (el precio no se mueve), tu predicción no aporta: acércate al plano.
      frente_a_ingenuas: summarizeHorizons(history.map((item) => item.score)).map((row) => ({
        horizonte: row.label,
        n: row.n,
        tu_error_pct: row.ai,
        error_plano_pct: row.flat,
        error_momentum_pct: row.momentum,
        tu_acierto_direccion_pct: row.aiHits,
        acierto_momentum_pct: row.momentumHits,
      })),
    },
    predicciones: history.map((item) => ({
      fecha: item.sessionDate,
      hora_et: etHHMM(item.asOf),
      ancla: item.anchor,
      sesgo: item.bias,
      confianza: item.confidence,
      precio_final_previsto: item.points[item.points.length - 1]?.p ?? null,
      razonamiento: item.reasoning.slice(0, 240),
      resultado: item.score && item.score.evaluated > 0
        ? {
            puntos_evaluados: `${item.score.evaluated}/${item.score.total}`,
            error_medio_pct: item.score.maePct,
            error_final_pct: item.score.endErrorPct,
            direccion_acertada: item.score.directionHit,
            muestra: item.score.checkpoints.map((point) => ({
              hora: etHHMM(point.t),
              previsto: point.predicted,
              real: point.actual,
            })),
          }
        : 'aún sin evaluar',
    })),
  };
}

export function buildBrief(input: BriefInput) {
  const { ticker, now, asOf, anchor, window, candles5m, live, news, ecosystem, ml, history } = input;

  return {
    ticker,
    ahora_et: etHHMM(now),
    sesion: { fecha: window.sessionDate, apertura: '09:30', cierre: '16:00' },
    ultima_vela: { hora_et: etHHMM(asOf), precio: anchor, nota: 'Polygon, ~15 min de retraso' },
    precio_web_tiempo_real: live ? { precio: live.price, hora_et: etHHMM(live.time * 1000), fuente: live.source } : null,
    n_puntos: window.targets.length,
    horas_objetivo: window.targets.map(etHHMM),
    ...(candles5m && candles5m.length > 0 ? candlesBlock(candles5m, window.sessionDate) : {}),
    noticias: news ? newsBlock(news) : null,
    ecosistema_ia: ecosystem ? ecosystemBlock(ecosystem, ticker) : null,
    modelos_ml: compactJson(ml, { maxArray: 15, maxString: 200 }),
    historial: historyBlock(history),
  };
}
