'use client';

import { useEffect, useState } from 'react';
import { fetchIntraday } from '../mlApi';
import { intervalFor } from '../overlays/remoteData';
import type { IntradayResponse } from '@/types/trading';

/**
 * La respuesta de `/intraday` — soportes, resistencias y estructura — que el
 * plan intradía necesita para existir.
 *
 * El panel del plan y el copiloto la quieren a la vez y para el mismo ticker.
 * El proxy `/api/ml` ya cachea `/intraday` 30 s, así que el coste real es bajo,
 * pero dos efectos idénticos en dos componentes se desincronizan: uno recarga
 * al cambiar de timeframe antes que el otro y durante un instante operan sobre
 * estructuras distintas. Una caché de módulo con dedupe de peticiones en vuelo
 * — el mismo patrón de `capabilities.ts` — hace que ambos vean exactamente lo
 * mismo en todo momento.
 */

export const INTRADAY_TIMEFRAMES = ['1m', '5m', '15m', '1h'];

/** Igual que el TTL del proxy para `/intraday`. */
const TTL_MS = 30_000;

type Entry = { at: number; result: { ok: true; data: IntradayResponse } | { ok: false; reason: string } };

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<Entry['result']>>();

async function load(ticker: string, timeframe: string): Promise<Entry['result']> {
  const key = `${ticker}:${timeframe}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.result;

  const pending = inFlight.get(key);
  if (pending) return pending;

  const interval = intervalFor(timeframe);
  const request = fetchIntraday(ticker, interval, interval >= 15 ? 2 : 1)
    .then((result) => {
      cache.set(key, { at: Date.now(), result });
      return result;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, request);
  return request;
}

export type IntradayStructure = {
  intraday: IntradayResponse | null;
  /** Por qué no hay estructura, cuando no la hay. */
  reason: string;
  loading: boolean;
  /** False en timeframes diarios, donde `/intraday` no significa nada. */
  supported: boolean;
};

export function useIntradayStructure(ticker: string, timeframe: string): IntradayStructure {
  const supported = INTRADAY_TIMEFRAMES.includes(timeframe);

  const [state, setState] = useState<Omit<IntradayStructure, 'supported'>>({
    intraday: null,
    reason: '',
    loading: supported,
  });

  useEffect(() => {
    if (!supported) {
      setState({ intraday: null, reason: '', loading: false });
      return;
    }

    let cancelled = false;
    setState({ intraday: null, reason: '', loading: true });

    load(ticker, timeframe).then((result) => {
      if (cancelled) return;
      setState(
        result.ok
          ? { intraday: result.data, reason: '', loading: false }
          : { intraday: null, reason: result.reason, loading: false }
      );
    });

    return () => {
      cancelled = true;
    };
  }, [ticker, timeframe, supported]);

  return { ...state, supported };
}
