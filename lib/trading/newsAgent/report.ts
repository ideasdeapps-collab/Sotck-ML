import { etParts } from '../chartTime';
import type { Candle } from '../marketData';
import { parseYahooChart, yahooUrl } from '../liveQuote/sources';
import { buildBrief, parseLlmReport, shouldAskLlm } from './llm';
import { MAX_MACRO, analystSummary, earningsInfo, mergeHeadlines, momentum, polygonSentiment } from './metrics';
import {
  MACRO_QUERY,
  newsUrls,
  parseDayChange,
  parseNasdaqEarnings,
  parseNasdaqInsiders,
  parseNasdaqRatings,
  parseNasdaqTarget,
  parsePolygonNews,
  parseRss,
} from './sources';
import type { Headline, LlmReport, NewsData, NewsReport } from './types';

/**
 * Arma el informe del agente para un ticker.
 *
 * Todo lo que toca la red entra por `AgentDeps`, así que los tests prueban la
 * orquestación entera sin red, y la ruta solo aporta `fetch` y OpenAI. Una
 * fuente que falla deja su bloque en null y su motivo en `failures`: el
 * informe sale siempre.
 */

export const DAILY_LLM_CALLS = 100;

export type AgentDeps = {
  now(): number;
  /** Lanza ante fallo de red o timeout; una respuesta con forma rara la resuelven los parsers. */
  json(url: string): Promise<unknown>;
  text(url: string): Promise<string>;
  dailyCandles(ticker: string): Promise<{ candles: Candle[]; source: string }>;
  /** Devuelve el contenido del mensaje de la IA (Gemini u OpenAI); lanza con un motivo legible. */
  askLlm(brief: ReturnType<typeof buildBrief>): Promise<unknown>;
  polygonKey: string | undefined;
  llmAvailable: boolean;
  model: string;
};

type LlmMemo = { ids: string[]; at: number; report: LlmReport; model: string };

/** Estado entre llamadas: último resumen por ticker y llamadas a la IA del día. */
export type AgentState = { memo: Map<string, LlmMemo>; budget: { day: string; calls: number } };

export function createAgentState(): AgentState {
  return { memo: new Map(), budget: { day: '', calls: 0 } };
}

const round = (value: number) => Number(value.toFixed(2));

export async function buildReport(ticker: string, deps: AgentDeps, state: AgentState): Promise<NewsReport> {
  const failures: string[] = [];

  async function attempt<T>(label: string, run: () => Promise<T | null>): Promise<T | null> {
    try {
      const value = await run();
      if (value === null) failures.push(`${label}: sin datos`);
      return value;
    } catch (error: any) {
      failures.push(`${label}: ${error?.message || 'error'}`);
      return null;
    }
  }

  const polygonKey = deps.polygonKey;
  if (!polygonKey) failures.push('Polygon: falta POLYGON_API_KEY');

  const [polygon, yahooNews, googleNews, macroNews, ratings, target, earnings, insiders, quote, vix, spy, trend] = await Promise.all([
    polygonKey
      ? attempt('Polygon', async () => parsePolygonNews(await deps.json(newsUrls.polygon(ticker, polygonKey)), ticker))
      : Promise.resolve(null),
    attempt('Yahoo RSS', async () => parseRss(await deps.text(newsUrls.yahooRss(ticker)), 'yahoo')),
    attempt('Google News', async () => parseRss(await deps.text(newsUrls.googleRss(newsUrls.tickerQuery(ticker))), 'google')),
    attempt('Geopolítica', async () => parseRss(await deps.text(newsUrls.googleRss(MACRO_QUERY)), 'google')),
    attempt('Analistas', async () => parseNasdaqRatings(await deps.json(newsUrls.ratings(ticker)))),
    attempt('Precio objetivo', async () => parseNasdaqTarget(await deps.json(newsUrls.target(ticker)))),
    attempt('Earnings', async () => parseNasdaqEarnings(await deps.json(newsUrls.earnings(ticker)))),
    attempt('Insiders', async () => parseNasdaqInsiders(await deps.json(newsUrls.insiders(ticker)))),
    attempt('Precio', async () => parseYahooChart(await deps.json(yahooUrl(ticker)))),
    attempt('VIX', async () => parseDayChange(await deps.json(yahooUrl('^VIX')))),
    attempt('SPY', async () => parseDayChange(await deps.json(yahooUrl('SPY')))),
    attempt('Momentum', async () => {
      const daily = await deps.dailyCandles(ticker);
      if (daily.source === 'demo') throw new Error('velas simuladas (sin POLYGON_API_KEY)');
      return momentum(daily.candles);
    }),
  ]);

  const now = deps.now();
  const headlines = mergeHeadlines([polygon ?? [], yahooNews ?? [], googleNews ?? []], now);
  const macro = mergeHeadlines([macroNews ?? []], now, MAX_MACRO);
  const price = quote?.price ?? null;

  const data: NewsData = {
    price,
    polygon: polygonSentiment(headlines),
    analysts: analystSummary(ratings, target, price),
    earnings: earningsInfo(earnings, now),
    insiders,
    market:
      vix || spy
        ? {
            vix: vix ? round(vix.price) : null,
            vixChange: vix ? round(vix.change) : null,
            spyChange: spy ? round(spy.change) : null,
          }
        : null,
    momentum: trend,
  };

  return {
    ticker,
    generatedAt: now,
    llm: await summarise(ticker, data, headlines, macro, now, deps, state),
    data,
    headlines,
    macro,
    failures,
  };
}

async function summarise(
  ticker: string,
  data: NewsData,
  headlines: Headline[],
  macro: Headline[],
  now: number,
  deps: AgentDeps,
  state: AgentState
): Promise<NewsReport['llm']> {
  if (!deps.llmAvailable) return { ok: false, reason: 'Ni GEMINI_API_KEY ni OPENAI_API_KEY están configuradas — solo datos y titulares' };

  // Sin titulares GPT solo podría glosar números que el panel ya enseña, o inventar.
  if (headlines.length === 0 && macro.length === 0) return { ok: false, reason: 'Sin titulares que resumir' };

  const ids = [...headlines, ...macro].map((headline) => headline.id);
  const memo = state.memo.get(ticker) ?? null;
  const previous = (note?: string): NewsReport['llm'] | null =>
    memo ? { ok: true, ...memo.report, at: memo.at, model: memo.model, ...(note ? { note } : {}) } : null;

  if (memo && !shouldAskLlm(memo, ids, now)) return previous()!;

  const day = etParts(now / 1000).date;
  if (state.budget.day !== day) state.budget = { day, calls: 0 };

  if (state.budget.calls >= DAILY_LLM_CALLS) {
    const reason = `Tope de ${DAILY_LLM_CALLS} resúmenes de IA por día alcanzado`;
    return previous(`Resumen anterior — ${reason}`) ?? { ok: false, reason };
  }

  state.budget.calls += 1;

  try {
    const report = parseLlmReport(await deps.askLlm(buildBrief({ ticker, data, headlines, macro, now })));
    if (!report) throw new Error('La IA devolvió un formato no reconocido');

    state.memo.set(ticker, { ids, at: now, report, model: deps.model });
    return { ok: true, ...report, at: now, model: deps.model };
  } catch (error: any) {
    const reason = error?.message || 'La petición a OpenAI falló';
    return previous(`Resumen anterior — ${reason}`) ?? { ok: false, reason };
  }
}
