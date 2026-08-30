import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

/**
 * Server-side proxy to the FastAPI ML service.
 *
 * Why a proxy and not a direct browser call: the ML service lives on another
 * host (Render), so a direct call depends on its CORS config and leaks the
 * backend URL into the bundle. Going through a route handler also gives us one
 * shared cache across tabs and the readable errors `fetchJson` expects.
 *
 * `ML_API_URL` is deliberately NOT prefixed with NEXT_PUBLIC_ — it must stay
 * server-side. The recharts dashboard in `app/*.tsx` still uses the public
 * variable; that is untouched.
 */

/**
 * Allow-list of upstream endpoints with their cache TTL in seconds. An
 * open proxy would let anyone use this deployment to hit arbitrary hosts, and
 * the TTLs matter: `/predict` re-derives features for every day of the horizon
 * and takes seconds, while `/intraday-live` is meant to be near-live.
 */
const ENDPOINTS: Record<string, number> = {
  // Capabilities — which tickers actually have a trained model.
  models: 300,
  'models-mlp': 300,
  'models-intraday': 300,
  'models-extended': 300,

  // Predictive curves (expensive, daily granularity).
  predict: 900,
  'predict-mlp': 900,
  'predict-extended': 900,
  forecast: 900,
  simulate: 900,
  technical: 900,
  validate: 900,
  psychology: 900,
  backtest: 600,

  // Intraday structure.
  'predict-intraday': 120,
  intraday: 30,
  signals: 60,
  patterns: 30,
  regime: 30,
  premarket: 60,

  // Near-live quotes.
  quote: 10,
  'intraday-live': 10,

  // Watchlist-wide scans.
  dashboard: 300,
  'signals-scan': 600,
};

type CacheEntry = { body: string; status: number; expiresAt: number };
const cache = new Map<string, CacheEntry>();

function unavailable(reason: string, status = 503) {
  return NextResponse.json({ unavailable: true, reason }, { status });
}

async function proxy(request: Request, endpoint: string, body?: string) {
  const ttl = ENDPOINTS[endpoint];

  if (ttl === undefined) {
    return unavailable(`Endpoint /${endpoint} is not exposed by the Trading Lab proxy`, 404);
  }

  const base = process.env.ML_API_URL;
  if (!base) {
    return unavailable('ML_API_URL is not set — predictive overlays are disabled');
  }

  const query = new URL(request.url).search;
  const cacheKey = `${body ? 'POST' : 'GET'}:${endpoint}${query}:${body ?? ''}`;
  const hit = cache.get(cacheKey);

  if (hit && hit.expiresAt > Date.now()) {
    return new NextResponse(hit.body, {
      status: hit.status,
      headers: { 'content-type': 'application/json', 'x-ml-cache': 'hit' },
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45000);

  try {
    const upstream = await fetch(`${base.replace(/\/$/, '')}/${endpoint}${query}`, {
      method: body ? 'POST' : 'GET',
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body,
      cache: 'no-store',
      signal: controller.signal,
    });

    const raw = await upstream.text();

    if (!upstream.headers.get('content-type')?.includes('application/json')) {
      return unavailable(`ML API returned a non-JSON response (HTTP ${upstream.status})`, 502);
    }

    // Only successful responses are cached: a 404 "no trained model" can be
    // fixed by a retrain, and errors must not stick around for 15 minutes.
    if (upstream.ok) {
      cache.set(cacheKey, { body: raw, status: upstream.status, expiresAt: Date.now() + ttl * 1000 });
    }

    return new NextResponse(raw, {
      status: upstream.status,
      headers: { 'content-type': 'application/json', 'x-ml-cache': 'miss' },
    });
  } catch (error: any) {
    const reason =
      error?.name === 'AbortError'
        ? `ML API timed out after 45s on /${endpoint}`
        : error?.message || 'ML API request failed';
    return unavailable(reason, 502);
  } finally {
    clearTimeout(timer);
  }
}

export async function GET(request: Request, context: { params: { path: string[] } }) {
  return proxy(request, context.params.path.join('/'));
}

export async function POST(request: Request, context: { params: { path: string[] } }) {
  const body = await request.text();
  return proxy(request, context.params.path.join('/'), body || '{}');
}
