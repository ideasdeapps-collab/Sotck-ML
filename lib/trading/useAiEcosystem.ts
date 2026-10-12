'use client';

import { useEffect, useState } from 'react';
import { fetchJson } from './fetchJson';
import type { TickerMove } from './aiEcosystem/moves';

/** Sondea `/api/ai-ecosystem` cada minuto con la pestaña visible; al volver a ella, en el acto. */

const POLL_MS = 60_000;

export type AiEcosystemState = {
  moves: Record<string, TickerMove | null>;
  failures: string[];
  generatedAt: number | null;
  error: string;
  loading: boolean;
};

export function useAiEcosystem(): AiEcosystemState {
  const [state, setState] = useState<AiEcosystemState>({ moves: {}, failures: [], generatedAt: null, error: '', loading: true });

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let inFlight = false;

    const poll = async () => {
      clearTimeout(timer);
      if (inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;

      try {
        const data = await fetchJson('/api/ai-ecosystem');
        if (disposed) return;

        if (data?.unavailable || !data?.moves) {
          setState((previous) => ({ ...previous, error: String(data?.reason || 'Sin datos de Polygon'), loading: false }));
        } else {
          setState({ moves: data.moves, failures: data.failures ?? [], generatedAt: data.generatedAt, error: '', loading: false });
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
  }, []);

  return state;
}
