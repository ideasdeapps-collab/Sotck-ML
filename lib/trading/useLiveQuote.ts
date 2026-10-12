'use client';

import { useEffect, useState } from 'react';
import { fetchJson } from './fetchJson';
import { appendQuote, type LiveQuote } from './overlays/liveTrail';

/**
 * Sondea `/api/market/live-quote` para el ticker del gráfico (siempre, no es un overlay).
 *
 * Solo con la pestaña visible: una pestaña olvidada en segundo plano no tiene
 * por qué seguir llamando a Yahoo cada 15 s. El rastro vive en memoria por
 * ticker — sobrevive a cambiar de ticker y volver, no a recargar la página.
 */

const POLL_MS = 15_000;

const trails = new Map<string, LiveQuote[]>();

export type LiveQuoteState = { trail: LiveQuote[]; error: string };

export function useLiveQuote(ticker: string): LiveQuoteState {
  const [state, setState] = useState<LiveQuoteState>({ trail: trails.get(ticker) ?? [], error: '' });

  useEffect(() => {
    setState({ trail: trails.get(ticker) ?? [], error: '' });

    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Volver a la pestaña con una consulta en vuelo abriría una segunda cadena de sondeo.
    let inFlight = false;

    const poll = async () => {
      clearTimeout(timer);
      if (inFlight || document.visibilityState !== 'visible') return;
      inFlight = true;

      try {
        const data = await fetchJson(`/api/market/live-quote?ticker=${encodeURIComponent(ticker)}`);
        if (disposed) return;

        if (data?.unavailable || !Number.isFinite(data?.price)) {
          setState((previous) => ({ ...previous, error: String(data?.reason || 'Sin precio web') }));
        } else {
          const trail = appendQuote(trails.get(ticker) ?? [], { price: data.price, time: data.time, source: data.source });
          trails.set(ticker, trail);
          setState({ trail, error: '' });
        }
      } catch (error: any) {
        if (!disposed) setState((previous) => ({ ...previous, error: error?.message || 'Sin precio web' }));
      }

      inFlight = false;

      if (!disposed) timer = setTimeout(poll, POLL_MS);
    };

    // Al volver a la pestaña se consulta en el acto en lugar de esperar al siguiente turno.
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
  }, [ticker]);

  return state;
}
