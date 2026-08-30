import { fetchJson } from './fetchJson';
import type {
  ChartOverlay,
  ForecastResponse,
  IntradayResponse,
  MlResult,
  PredictCurve,
  PremarketResponse,
  PsychologyResponse,
  RegimeResponse,
  SessionPrediction,
  SignalsResponse,
  TechnicalResponse,
} from '@/types/trading';

/**
 * Typed client for the FastAPI ML service, via the /api/ml proxy.
 *
 * Every function resolves to an `MlResult` and never rejects. An overlay whose
 * data failed to load must degrade to "unavailable" in the UI — it must not
 * take the chart down with it.
 */

const BASE = '/api/ml';

function query(params: Record<string, string | number | undefined>) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const rendered = search.toString();
  return rendered ? `?${rendered}` : '';
}

/** Turns whatever came back — proxy error, FastAPI detail, or data — into a result. */
function interpret<T>(payload: any): MlResult<T> {
  if (payload && typeof payload === 'object') {
    if (payload.unavailable) return { ok: false, reason: String(payload.reason || 'ML API unavailable') };
    if (payload.detail) return { ok: false, reason: String(payload.detail) };
  }
  return { ok: true, data: payload as T };
}

async function get<T>(endpoint: string, params: Record<string, string | number | undefined> = {}): Promise<MlResult<T>> {
  try {
    return interpret<T>(await fetchJson(`${BASE}/${endpoint}${query(params)}`));
  } catch (error: any) {
    return { ok: false, reason: error?.message || `Failed to reach /${endpoint}` };
  }
}

async function post<T>(endpoint: string, body: Record<string, unknown>): Promise<MlResult<T>> {
  try {
    return interpret<T>(
      await fetchJson(`${BASE}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    );
  } catch (error: any) {
    return { ok: false, reason: error?.message || `Failed to reach /${endpoint}` };
  }
}

// --- Predictive curves ------------------------------------------------------

export const fetchXgbCurve = (ticker: string, horizon = 30) =>
  post<PredictCurve>('predict', { ticker, horizon });

export const fetchMlpCurve = (ticker: string, horizon = 21) =>
  get<PredictCurve>('predict-mlp', { ticker, horizon });

export const fetchExtendedCurve = (ticker: string, horizon = 30) =>
  get<PredictCurve>('predict-extended', { ticker, horizon });

/** Monte Carlo bands. `save: false` — the Lab must not write history rows. */
export const fetchForecast = (ticker: string, horizon = 30, nSims = 10000) =>
  post<ForecastResponse>('forecast', { ticker, horizon, n_sims: nSims, save: false });

export const fetchSessionCurve = (ticker: string) =>
  get<SessionPrediction>('predict-intraday', { ticker });

export const fetchTechnical = (ticker: string, horizon = 20, zigzag = 0.03) =>
  get<TechnicalResponse>('technical', { ticker, horizon, zigzag });

// --- Intraday structure -----------------------------------------------------

export const fetchIntraday = (ticker: string, interval = 15, days = 1) =>
  get<IntradayResponse>('intraday', { ticker, interval, days });

export const fetchSignals = (ticker: string, interval = 15, days = 2) =>
  get<SignalsResponse>('signals', { ticker, interval, days });

export const fetchPatterns = (ticker: string, interval = 15, days = 1) =>
  get<ChartOverlay>('patterns', { ticker, interval, days });

export const fetchRegime = (ticker: string, interval = 15, days = 1) =>
  get<RegimeResponse>('regime', { ticker, interval, days });

export const fetchPremarket = (ticker: string) => get<PremarketResponse>('premarket', { ticker });

export const fetchPsychology = (ticker: string, horizon = 21) =>
  get<PsychologyResponse>('psychology', { ticker, horizon });

// --- Capabilities -----------------------------------------------------------

export const fetchTrainedTickers = (endpoint: 'models' | 'models-mlp' | 'models-intraday' | 'models-extended') =>
  get<{ available?: string[] }>(endpoint);
