import {
  fetchExtendedCurve,
  fetchForecast,
  fetchMlpCurve,
  fetchPatterns,
  fetchSessionCurve,
  fetchTechnical,
  fetchXgbCurve,
} from '../mlApi';
import { OVERLAYS, type OverlayId, type OverlaySource, type OverlayState } from './registry';
import type {
  ForecastResponse,
  MlResult,
  PatternsResponse,
  PredictCurve,
  SessionPrediction,
  TechnicalResponse,
} from '@/types/trading';

/** Everything the enabled overlays need from the ML API, fetched once per source. */
export type RemoteOverlayData = {
  xgb?: MlResult<PredictCurve>;
  mlp?: MlResult<PredictCurve>;
  extended?: MlResult<PredictCurve>;
  forecast?: MlResult<ForecastResponse>;
  session?: MlResult<SessionPrediction>;
  technical?: MlResult<TechnicalResponse>;
  patterns?: MlResult<PatternsResponse>;
};

/** Which remote sources the currently enabled, currently allowed overlays need. */
export function requiredSources(
  enabled: OverlayState,
  isAllowed: (id: OverlayId) => boolean
): OverlaySource[] {
  const sources = new Set<OverlaySource>();

  for (const overlay of OVERLAYS) {
    if (overlay.source === 'local') continue;
    if (!enabled[overlay.id]) continue;
    if (!isAllowed(overlay.id)) continue;
    sources.add(overlay.source);
  }

  return Array.from(sources);
}

/** Minutes per bar, so /patterns is asked for the same granularity the chart shows. */
function intervalFor(timeframe: string): number {
  const map: Record<string, number> = { '1m': 1, '5m': 5, '15m': 15, '1h': 60 };
  return map[timeframe] ?? 15;
}

export async function loadRemoteOverlays(
  ticker: string,
  timeframe: string,
  sources: OverlaySource[]
): Promise<RemoteOverlayData> {
  const interval = intervalFor(timeframe);

  const jobs = sources.map(async (source): Promise<[OverlaySource, unknown]> => {
    switch (source) {
      case 'xgb':
        return ['xgb', await fetchXgbCurve(ticker)];
      case 'mlp':
        return ['mlp', await fetchMlpCurve(ticker)];
      case 'extended':
        return ['extended', await fetchExtendedCurve(ticker)];
      case 'forecast':
        return ['forecast', await fetchForecast(ticker)];
      case 'session':
        return ['session', await fetchSessionCurve(ticker)];
      case 'technical':
        return ['technical', await fetchTechnical(ticker)];
      case 'patterns':
        return ['patterns', await fetchPatterns(ticker, interval, interval >= 15 ? 2 : 1)];
      default:
        return [source, undefined];
    }
  });

  const settled = await Promise.all(jobs);
  const data: RemoteOverlayData = {};

  for (const [source, result] of settled) {
    if (source !== 'local') (data as Record<string, unknown>)[source] = result;
  }

  return data;
}
