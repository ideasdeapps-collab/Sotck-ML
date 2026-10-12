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
const LLM_TIMEOUT_MS = 65_000;
/** Cada fuente tiene este tiempo; la que no llega se queda fuera del contexto. */
const SOURCE_TIMEOUT_MS = 20_000;
/**
 * La API de ML (Render) tarda 15–45 s en sus endpoints pesados; con 20 s se
 * perdían justo los modelos con ventaja medida. 50 s cabe en el maxDuration
 * de la ruta junto con DeepSeek.
 */
const ML_TIMEOUT_MS = 50_000;
/** Salidas de ML reutilizables entre el calentamiento y la generación. */
const ML_CACHE_TTL_MS = 3 * 60_000;
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

function withTimeout<T>(promise: Promise<T>, label: string, ms = SOURCE_TIMEOUT_MS): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`sin respuesta en ${ms / 1000} s`)), ms)),
  ]);
}

const seconds = (ms: number) => `${(ms / 1000).toFixed(1)} s`;

async function mlJson(path: string): Promise<unknown> {
  const base = process.env.ML_API_URL;
  if (!base) throw new Error('ML_API_URL no está configurada');
  const response = await fetch(`${base.replace(/\/$/, '')}/${path}`, { cache: 'no-store', signal: AbortSignal.timeout(ML_TIMEOUT_MS) }).catch(
    (error) => {
      throw new Error(error?.name === 'TimeoutError' ? `sin respuesta en ${ML_TIMEOUT_MS / 1000} s` : error?.message || 'error de red');
    }
  );
  const json = await response.json().catch(() => null);
  if (!response.ok || !json) throw new Error(json?.detail || `HTTP ${response.status}`);
  return json;
}

/** Resultado de un endpoint de ML: la respuesta o el motivo, y cuánto tardó. */
export type MlOutcome = { label: string; ms: number } & ({ ok: true; data: unknown } | { ok: false; reason: string });

const mlCache = new Map<string, { at: number; promise: Promise<MlOutcome[]> }>();

/**
 * Todas las salidas de ML del ticker, en paralelo. Se cachean 3 min y las
 * peticiones en vuelo se comparten: el panel «calienta» al elegir ticker y la
 * generación reutiliza ese resultado (o espera al que ya está en camino) en
 * lugar de volver a cargar la API de ML con las mismas siete peticiones.
 */
export function mlContext(ticker: string): Promise<MlOutcome[]> {
  const hit = mlCache.get(ticker);
  if (hit && Date.now() - hit.at < ML_CACHE_TTL_MS) return hit.promise;

  const promise = Promise.all(
    Object.entries(ML_ENDPOINTS).map(async ([label, path]): Promise<MlOutcome> => {
      const started = Date.now();
      try {
        const data = await mlJson(path(encodeURIComponent(ticker)));
        return { label, ms: Date.now() - started, ok: true, data };
      } catch (error: any) {
        return { label, ms: Date.now() - started, ok: false, reason: error?.message || 'error' };
      }
    })
  );

  mlCache.set(ticker, { at: Date.now(), promise });
  // Un calentamiento en el que todo falló no debe bloquear 3 min un reintento.
  promise.then((outcomes) => {
    if (outcomes.every((outcome) => !outcome.ok)) mlCache.delete(ticker);
  });
  return promise;
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

  // Los resultados guardados antes de que existieran los horizontes se recalculan si aún hay barras.
  const stale = (item: AiPrediction) => !item.score?.complete || !item.score.horizons;
  const pending = predictions.filter(stale);
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
      if (!stale(item) || !bars) return item;

      const score = scorePrediction(item.points, item.anchor, bars, item.asOf);
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

  const [candles5m, live, news, ecosystem, history, mlOutcomes] = await Promise.all([
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
    mlContext(ticker),
  ]);

  const ml: Record<string, unknown> = {};
  for (const outcome of mlOutcomes) {
    if (outcome.ok) {
      ml[outcome.label] = outcome.data;
      sources.push(`ML ${outcome.label} (${seconds(outcome.ms)})`);
    } else {
      failures.push(`ML ${outcome.label}: ${outcome.reason} (${seconds(outcome.ms)})`);
    }
  }

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
