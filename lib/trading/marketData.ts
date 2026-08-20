export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type CandleSource = "polygon" | "polygon-cached" | "polygon-stale" | "demo";

export type CandleResponse = {
  ticker: string;
  timeframe: string;
  candles: Candle[];
  source: CandleSource;
  fetchedAt?: number;
  note?: string;
};

const TIMEFRAMES: Record<string, { multiplier: number; timespan: string; lookbackDays: number }> = {
  "1m": { multiplier: 1, timespan: "minute", lookbackDays: 3 },
  "5m": { multiplier: 5, timespan: "minute", lookbackDays: 7 },
  "15m": { multiplier: 15, timespan: "minute", lookbackDays: 14 },
  "1h": { multiplier: 1, timespan: "hour", lookbackDays: 60 },
  "1H": { multiplier: 1, timespan: "hour", lookbackDays: 60 },
  "1d": { multiplier: 1, timespan: "day", lookbackDays: 365 },
  "1D": { multiplier: 1, timespan: "day", lookbackDays: 365 },
};

function resolveTimeframe(timeframe: string) {
  return TIMEFRAMES[timeframe] || TIMEFRAMES["1m"];
}

function secondsPerBar(timeframe: string) {
  const { multiplier, timespan } = resolveTimeframe(timeframe);
  const unit = timespan === "day" ? 86400 : timespan === "hour" ? 3600 : 60;
  return unit * multiplier;
}

/**
 * Deterministic synthetic series so Trading Lab stays usable without a
 * POLYGON_API_KEY (local dev, preview deployments).
 */
export function buildDemoCandles(ticker: string, timeframe = "1m", count = 240): Candle[] {
  const step = secondsPerBar(timeframe);
  const now = Math.floor(Date.now() / 1000);
  const start = now - now % step - step * count;

  let seed = 0;
  for (const char of ticker) seed = (seed * 31 + char.charCodeAt(0)) % 9973;
  const random = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };

  let price = 80 + (seed % 200);
  const candles: Candle[] = [];

  for (let i = 0; i < count; i++) {
    const drift = (random() - 0.48) * price * 0.004;
    const open = price;
    const close = Math.max(1, open + drift);
    const high = Math.max(open, close) * (1 + random() * 0.002);
    const low = Math.min(open, close) * (1 - random() * 0.002);

    candles.push({
      time: start + i * step,
      open: +open.toFixed(2),
      high: +high.toFixed(2),
      low: +low.toFixed(2),
      close: +close.toFixed(2),
      volume: Math.round(200000 + random() * 800000),
    });

    price = close;
  }

  return candles;
}

/**
 * Short per-ticker cache. The Starter plan has unlimited calls, so this exists
 * to collapse duplicate requests from multiple open tabs rather than to stay
 * under a quota. Override with TTL_INTRADAY / TTL_DAILY (seconds).
 */
type CacheEntry = { response: CandleResponse; expiresAt: number };
const cache = new Map<string, CacheEntry>();

function ttlFor(timeframe: string) {
  const { timespan } = resolveTimeframe(timeframe);
  const daily = Number(process.env.TTL_DAILY) || 3600;
  const intraday = Number(process.env.TTL_INTRADAY) || 15;
  return (timespan === "day" ? daily : intraday) * 1000;
}

export async function getCandles(ticker = "NVDA", timeframe = "1m"): Promise<CandleResponse> {
  const symbol = String(ticker || "NVDA").toUpperCase();
  const apiKey = process.env.POLYGON_API_KEY;

  const cacheKey = `${symbol}:${timeframe}`;
  const cached = cache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now()) {
    return { ...cached.response, source: "polygon-cached" };
  }

  if (!apiKey) {
    return {
      ticker: symbol,
      timeframe,
      candles: buildDemoCandles(symbol, timeframe),
      source: "demo",
      note: "POLYGON_API_KEY not set — serving simulated candles",
    };
  }

  const { multiplier, timespan, lookbackDays } = resolveTimeframe(timeframe);
  const to = new Date();
  const from = new Date(to.getTime() - lookbackDays * 24 * 60 * 60 * 1000);

  const url =
    `https://api.polygon.io/v2/aggs/ticker/${symbol}/range/${multiplier}/${timespan}` +
    `/${from.toISOString().slice(0, 10)}/${to.toISOString().slice(0, 10)}` +
    `?adjusted=true&sort=asc&limit=5000&apiKey=${apiKey}`;

  try {
    const response = await fetch(url, { cache: "no-store" });
    const data = await response.json();

    if (!response.ok || !Array.isArray(data.results) || data.results.length === 0) {
      const reason =
        response.status === 429
          ? "Polygon rate limit reached"
          : data?.error || data?.message || `Polygon returned no data (${response.status})`;

      // Prefer stale real data over silently swapping in synthetic candles.
      if (cached) {
        return { ...cached.response, source: "polygon-stale", note: reason };
      }

      return {
        ticker: symbol,
        timeframe,
        candles: buildDemoCandles(symbol, timeframe),
        source: "demo",
        note: reason,
      };
    }

    const candles: Candle[] = data.results.map((item: any) => ({
      time: Math.floor(item.t / 1000),
      open: item.o,
      high: item.h,
      low: item.l,
      close: item.c,
      volume: item.v,
    }));

    const fresh: CandleResponse = {
      ticker: symbol,
      timeframe,
      candles,
      source: "polygon",
      fetchedAt: Date.now(),
    };

    cache.set(cacheKey, { response: fresh, expiresAt: Date.now() + ttlFor(timeframe) });

    return fresh;
  } catch (error: any) {
    const reason = error?.message || "Polygon request failed";

    if (cached) {
      return { ...cached.response, source: "polygon-stale", note: reason };
    }

    return {
      ticker: symbol,
      timeframe,
      candles: buildDemoCandles(symbol, timeframe),
      source: "demo",
      note: reason,
    };
  }
}
