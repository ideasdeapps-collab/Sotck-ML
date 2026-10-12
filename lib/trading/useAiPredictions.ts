'use client';

import { useCallback, useEffect, useState } from 'react';
import { fetchJson } from './fetchJson';
import type { AiPrediction } from './aiPrediction/types';

/**
 * Predicciones guardadas (de este ticker o de todos) y el botón de generar.
 * La lista se relee al cambiar de ticker o de alcance, tras generar y cada
 * 5 min con la pestaña visible, para que el resultado real se vaya completando.
 */

const POLL_MS = 5 * 60_000;

export type AiPredictionsState = {
  predictions: AiPrediction[];
  listError: string;
  loading: boolean;
  generating: boolean;
  generateError: string;
  generate: () => Promise<AiPrediction | null>;
  reload: () => void;
};

export function useAiPredictions(ticker: string, all: boolean): AiPredictionsState {
  const [predictions, setPredictions] = useState<AiPrediction[]>([]);
  const [listError, setListError] = useState('');
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState('');
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      clearTimeout(timer);
      if (document.visibilityState === 'visible') {
        setLoading(true);
        try {
          const data = await fetchJson(all ? '/api/ai-prediction?all=1' : `/api/ai-prediction?ticker=${encodeURIComponent(ticker)}`);
          if (disposed) return;
          if (data?.unavailable || !Array.isArray(data?.predictions)) {
            setListError(String(data?.reason || 'No se pudieron leer las predicciones'));
          } else {
            setPredictions(data.predictions);
            setListError('');
          }
        } catch (error: any) {
          if (!disposed) setListError(error?.message || 'No se pudieron leer las predicciones');
        }
        if (!disposed) setLoading(false);
      }
      if (!disposed) timer = setTimeout(load, POLL_MS);
    };

    load();
    return () => {
      disposed = true;
      clearTimeout(timer);
    };
  }, [ticker, all, reloadKey]);

  useEffect(() => setGenerateError(''), [ticker]);

  const generate = useCallback(async () => {
    setGenerating(true);
    setGenerateError('');
    try {
      const data = await fetchJson('/api/ai-prediction', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ticker }),
      });
      if (data?.unavailable || !data?.prediction) {
        setGenerateError(String(data?.reason || 'No se pudo generar la predicción'));
        return null;
      }
      setReloadKey((key) => key + 1);
      return data.prediction as AiPrediction;
    } catch (error: any) {
      setGenerateError(error?.message || 'No se pudo generar la predicción');
      return null;
    } finally {
      setGenerating(false);
    }
  }, [ticker]);

  const reload = useCallback(() => setReloadKey((key) => key + 1), []);

  return { predictions, listError, loading, generating, generateError, generate, reload };
}
