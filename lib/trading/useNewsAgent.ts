'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchJson } from './fetchJson';
import type { NewsReport } from './newsAgent/types';

/**
 * Sondea `/api/news-agent` cada 5 min mientras la pestaña está visible, y al
 * momento al cambiar de ticker o volver a la pestaña. La ruta cachea 5 min por
 * ticker, así que volver a la pestaña no paga un informe nuevo.
 */

export const NEWS_POLL_MS = 5 * 60_000;
/** Igual que en la ruta: ↻ no fuerza un informe nuevo más de una vez por minuto. */
export const NEWS_REFRESH_MIN_MS = 60_000;

export type NewsAgentState = {
  report: NewsReport | null;
  error: string;
  loading: boolean;
  /** Epoch ms de la última respuesta (buena o mala); 0 si aún no hubo ninguna. */
  fetchedAt: number;
};

const INITIAL: NewsAgentState = { report: null, error: '', loading: true, fetchedAt: 0 };

export function useNewsAgent(ticker: string) {
  const [state, setState] = useState<NewsAgentState>(INITIAL);
  const pollRef = useRef<(force?: boolean) => void>(() => {});

  useEffect(() => {
    setState(INITIAL);

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Volver a la pestaña con una consulta en vuelo abriría una segunda cadena de sondeo.
    let inFlight = false;

    const poll = async (force = false) => {
      clearTimeout(timer);
      if (inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;
      setState((previous) => ({ ...previous, loading: true }));

      try {
        const data = await fetchJson(
          `/api/news-agent?ticker=${encodeURIComponent(ticker)}${force ? '&force=1' : ''}`
        );
        if (disposed) return;

        // Un informe de otro ticker (respuesta tardía o error con otra forma) no se pinta.
        if (data?.ticker !== ticker) throw new Error(String(data?.reason || 'Respuesta del agente no reconocida'));

        setState({ report: data as NewsReport, error: '', loading: false, fetchedAt: Date.now() });
      } catch (error: any) {
        if (!disposed) {
          setState((previous) => ({
            ...previous,
            error: error?.message || 'El agente no respondió',
            loading: false,
            fetchedAt: Date.now(),
          }));
        }
      }

      inFlight = false;
      if (!disposed) timer = setTimeout(() => poll(), NEWS_POLL_MS);
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') poll();
    };

    pollRef.current = poll;
    poll();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      disposed = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [ticker]);

  const refresh = useCallback(() => pollRef.current(true), []);

  return { ...state, refresh, nextAt: state.fetchedAt ? state.fetchedAt + NEWS_POLL_MS : null };
}
