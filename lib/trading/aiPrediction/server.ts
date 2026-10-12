import { getCandles } from '../marketData';
import { minuteBars } from '../polygonMinutes';
import { getLiveQuote } from '../liveQuote/server';
import { getNewsReport } from '../newsAgent/server';
import { getEcosystem } from '../aiEcosystem/server';
import type { Bar } from '../aiEcosystem/moves';
import { buildBrief } from './brief';
import { SYSTEM_PROMPT, parsePrediction } from './llm';
import { scorePrediction } from './score';
import { sessionWindow } from './session';
import { insertPrediction, listPredictions, saveScore, storeEnabled } from './store';
import type { AiPrediction } from './types';

/**
 * Predicción del resto de la sesión con DeepSeek, lado servidor.
 *
 * 1. Recoge en paralelo todo lo que la app ya produce (velas e indicadores,
 *    precio web, agente de noticias, ecosistema IA, modelos de ML) y el
 *    historial de predicciones de este ticker con su resultado real.
 * 2. Pide a DeepSeek un precio cada 5 min hasta el cierre.
 * 3. Guarda la predicción y el contexto exacto en Supabase.
 *
 * Una fuente que falla no tumba la predicción: se anota en `failures` y la IA
 * trabaja con el resto. Sin barras de Polygon, sin DeepSeek o sin Supabase no
 * hay predicción.
 */

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const DEFAULT_MODEL = 'deepseek-chat';
const LLM_TIMEOUT_MS = 70_000;
/** Cada fuente tiene este tiempo; la que no llega se queda fuera del contexto. */
const SOURCE_TIMEOUT_MS = 20_000;
const HISTORY_SIZE = 8;
const MINUTE = 60_000;

/** Salidas de la API de ML que se pasan como contexto (las mismas que pintan los overlays intradía). */
const ML_ENDPOINTS: Record<string, (ticker: string) => string> = {
  curva_sesion: (ticker) => `predict-intraday?ticker=${ticker}`,
  curva_1m: (ticker) => `predict-1m?ticker=${ticker}&horizon=30`,
  senal_1m: (ticker) => `signal-1m?ticker=${ticker}`,
  estructura_intradia: (ticker) => `intraday?ticker=${ticker}&interval=15&days=1`,
  patrones: (ticker) => `patterns?ticker=${ticker}&interval=15&days=1`,
  regimen: (ticker) => `regime?ticker=${ticker}&interval=15&days=1`,
  premarket: (ticker) => `premarket?ticker=${ticker}`,
};

export const deepseekModel = () => process.env.DEEPSEEK_MODEL || DEFAULT_MODEL;

function withTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`${label}: sin respuesta en ${SOURCE_TIMEOUT_MS / 1000} s`)), SOURCE_TIMEOUT_MS)),
  ]);
}

async function mlJson(path: string): Promise<unknown> {
  const base = process.env.ML_API_URL;
  if (!base) throw new Error('ML_API_URL no está configurada');
  const response = await fetch(`${base.replace(/\/$/, '')}/${path}`, { cache: 'no-store', signal: AbortSignal.timeout(SOURCE_TIMEOUT_MS) });
  const json = await response.json().catch(() => null);
  if (!response.ok || !json) throw new Error(json?.detail || `HTTP ${response.status}`);
  return json;
}

async function askDeepSeek(brief: unknown): Promise<string> {
  const response = await fetch(DEEPSEEK_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}` },
    body: JSON.stringify({
      model: deepseekModel(),
      temperature: 0.4,
      max_tokens: 2500,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(brief) },
      ],
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  }).catch((error) => {
    throw new Error(error?.name === 'TimeoutError' ? `DeepSeek no respondió en ${LLM_TIMEOUT_MS / 1000} s` : error?.message || 'La petición a DeepSeek falló');
  });

  const raw = await response.text();
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      detail = JSON.parse(raw)?.error?.message || detail;
    } catch {
      /* sin JSON: el código basta */
    }
    throw new Error(`DeepSeek rechazó la petición — ${detail}`);
  }

  const content = JSON.parse(raw)?.choices?.[0]?.message?.content;
  if (typeof content !== 'string' || !content.trim()) throw new Error('DeepSeek devolvió una respuesta vacía');
  return content;
}

/**
 * Añade el resultado real a las predicciones que lo necesiten. Las barras de
 * 1 min cubren ~5 días; lo que ya terminó se guarda y no se vuelve a calcular.
 */
export async function withScores(predictions: AiPrediction[], polygonKey: string | undefined): Promise<AiPrediction[]> {
  if (!polygonKey) return predictions;

  const pending = predictions.filter((item) => !item.score?.complete);
  const tickers = Array.from(new Set(pending.map((item) => item.ticker))).slice(0, 12);
  const barsByTicker = new Map<string, Bar[]>();

  await Promise.all(
    tickers.map(async (ticker) => {
      const bars = await minuteBars(ticker, polygonKey);
      if (typeof bars !== 'string') barsByTicker.set(ticker, bars);
    })
  );

  return Promise.all(
    predictions.map(async (item) => {
      const bars = barsByTicker.get(item.ticker);
      if (item.score?.complete || !bars) return item;

      const score = scorePrediction(item.points, item.anchor, bars);
      if (score.complete) await saveScore(item.id, score).catch(() => undefined);
      return { ...item, score };
    })
  );
}

export async function generatePrediction(ticker: string): Promise<AiPrediction> {
  if (!process.env.DEEPSEEK_API_KEY) throw new Error('DEEPSEEK_API_KEY no está configurada');
  if (!storeEnabled()) throw new Error('SUPABASE_URL o SUPABASE_SERVICE_KEY no están configuradas');
  const polygonKey = process.env.POLYGON_API_KEY;
  if (!polygonKey) throw new Error('POLYGON_API_KEY no está configurada');

  const now = Date.now();
  const bars = await minuteBars(ticker, polygonKey, now);
  if (typeof bars === 'string') throw new Error(`Sin barras de Polygon — ${bars}`);

  const sorted = [...bars].sort((a, b) => a.t - b.t);
  const last = sorted[sorted.length - 1];
  const asOf = last.t + MINUTE;
  const anchor = last.c;

  const window = sessionWindow(now, asOf);
  if (typeof window === 'string') throw new Error(window);

  const failures: string[] = [];
  const sources: string[] = [];

  async function source<T>(label: string, load: () => Promise<T>): Promise<T | null> {
    try {
      const value = await withTimeout(load(), label);
      sources.push(label);
      return value;
    } catch (error: any) {
      failures.push(`${label}: ${error?.message || 'error'}`);
      return null;
    }
  }

  const [candles5m, live, news, ecosystem, history, ...mlResults] = await Promise.all([
    source('velas 5m', async () => {
      const { candles, source: origin } = await getCandles(ticker, '5m');
      if (origin === 'demo') throw new Error('solo hay velas simuladas');
      return candles;
    }),
    source('precio web', async () => {
      const quote = await getLiveQuote(ticker);
      if (typeof quote === 'string') throw new Error(quote);
      return quote;
    }),
    source('noticias', async () => (await getNewsReport(ticker)).report),
    source('ecosistema IA', async () => (await getEcosystem(polygonKey)).report),
    source('historial', async () => withScores(await listPredictions(ticker, HISTORY_SIZE), polygonKey)),
    ...Object.entries(ML_ENDPOINTS).map(([label, path]) => source(`ML ${label}`, () => mlJson(path(encodeURIComponent(ticker))))),
  ]);

  const ml = Object.fromEntries(
    Object.keys(ML_ENDPOINTS)
      .map((label, i) => [label, mlResults[i]] as const)
      .filter(([, value]) => value !== null)
  );

  const brief = buildBrief({
    ticker,
    now,
    asOf,
    anchor,
    window,
    candles5m,
    live,
    news,
    ecosystem,
    ml,
    history: history ?? [],
  });

  const parsed = parsePrediction(await askDeepSeek(brief), window.targets, anchor);
  if (typeof parsed === 'string') throw new Error(parsed);

  return insertPrediction(
    {
      ticker,
      asOf,
      anchor,
      sessionDate: window.sessionDate,
      model: deepseekModel(),
      ...parsed,
      score: null,
      sources,
      failures,
    },
    brief
  );
}
