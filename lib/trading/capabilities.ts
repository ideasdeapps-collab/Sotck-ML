import { fetchTrainedTickers } from './mlApi';
import type { MlResult, TickerCapabilities } from '@/types/trading';

/**
 * Which predictive curves actually exist for a ticker.
 *
 * This is not a nicety. The Lab's default watchlist is
 * NVDA, AMD, TSLA, AAPL, SNDK, MSFT, SPY — and only NVDA and SNDK have a
 * trained model in `api/artifacts/`. Without this gate, five of the seven
 * tickers would show overlay toggles that can only ever return a 404.
 *
 * The four /models* endpoints are cheap and cached by the proxy for 5 minutes;
 * this adds a process-lifetime cache so switching tickers costs nothing.
 */

export type CapabilityMap = {
  xgb: Set<string>;
  mlp: Set<string>;
  intraday: Set<string>;
  extended: Set<string>;
  /** Empty when the ML API could not be reached at all. */
  reachable: boolean;
  reason?: string;
};

const EMPTY: CapabilityMap = {
  xgb: new Set(),
  mlp: new Set(),
  intraday: new Set(),
  extended: new Set(),
  reachable: false,
};

/** Matches the proxy's TTL for /models*, so a retrain shows up without a reload. */
const TTL_MS = 5 * 60 * 1000;

let cached: CapabilityMap | null = null;
let cachedAt = 0;
let inFlight: Promise<CapabilityMap> | null = null;

export async function loadCapabilities(force = false): Promise<CapabilityMap> {
  const fresh = cached !== null && Date.now() - cachedAt < TTL_MS;
  if (!force && fresh) return cached as CapabilityMap;
  if (!force && inFlight) return inFlight;

  inFlight = (async () => {
    const [xgb, mlp, intraday, extended] = await Promise.all([
      fetchTrainedTickers('models'),
      fetchTrainedTickers('models-mlp'),
      fetchTrainedTickers('models-intraday'),
      fetchTrainedTickers('models-extended'),
    ]);

    // If /models itself failed the service is down; the other three tell us
    // nothing useful on their own.
    if (!xgb.ok) {
      cached = { ...EMPTY, reason: xgb.reason };
      cachedAt = Date.now();
      return cached;
    }

    const toSet = (result: MlResult<{ available?: string[] }>) =>
      new Set(result.ok ? (result.data.available ?? []).map((t) => t.toUpperCase()) : []);

    cached = {
      xgb: toSet(xgb),
      mlp: toSet(mlp),
      intraday: toSet(intraday),
      extended: toSet(extended),
      reachable: true,
    };
    cachedAt = Date.now();

    return cached;
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

export function capabilitiesFor(map: CapabilityMap, ticker: string): TickerCapabilities {
  const symbol = ticker.toUpperCase();
  return {
    xgb: map.xgb.has(symbol),
    mlp: map.mlp.has(symbol),
    intraday: map.intraday.has(symbol),
    extended: map.extended.has(symbol),
  };
}
