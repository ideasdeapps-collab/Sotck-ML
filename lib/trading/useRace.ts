'use client';

import { useEffect, useState } from 'react';
import { fetchJson } from './fetchJson';
import type { Race } from './race/race';

/** Sondea `/api/race` cada minuto con la pestaña visible, y al momento al cambiar la lista. */

const POLL_MS = 60_000;

export type RaceState = { race: Race | null; failures: string[]; generatedAt: number | null; error: string; loading: boolean };

const INITIAL: RaceState = { race: null, failures: [], generatedAt: null, error: '', loading: true };

export function useRace(tickers: string[]): RaceState {
  const key = tickers.join(',');
  const [state, setState] = useState<RaceState>(INITIAL);

  useEffect(() => {
    setState(INITIAL);
    if (!key) {
      setState({ ...INITIAL, loading: false, error: 'Elige al menos un ticker' });
      return;
    }

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;

    const poll = async () => {
      clearTimeout(timer);
      if (inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;

      try {
        const data = await fetchJson(`/api/race?tickers=${encodeURIComponent(key)}`);
        if (disposed) return;

        if (data?.unavailable || !Array.isArray(data?.lanes)) {
          setState((previous) => ({ ...previous, error: String(data?.reason || 'Sin datos de Polygon'), loading: false }));
        } else {
          setState({
            race: { frames: data.frames, lanes: data.lanes },
            failures: data.failures ?? [],
            generatedAt: data.generatedAt,
            error: '',
            loading: false,
          });
        }
      } catch (error: any) {
        if (!disposed) setState((previous) => ({ ...previous, error: error?.message || 'Sin datos de Polygon', loading: false }));
      }

      inFlight = false;
      if (!disposed) timer = setTimeout(poll, POLL_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') poll();
    };

    poll();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [key]);

  return state;
}
