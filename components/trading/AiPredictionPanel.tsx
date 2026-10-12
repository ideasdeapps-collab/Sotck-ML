'use client';

import { useEffect, useRef, useState } from 'react';
import { useTradingStore } from '@/lib/trading/tradingStore';
import { useAiPredictions } from '@/lib/trading/useAiPredictions';
import { etHHMM } from '@/lib/trading/aiPrediction/session';
import { etParts } from '@/lib/trading/chartTime';
import type { AiPrediction, PredictionScore } from '@/lib/trading/aiPrediction/types';

/**
 * Predicción del resto de la sesión con IA (DeepSeek), bajo el gráfico.
 *
 * El botón genera una nueva a partir de todo lo que la app ya calcula; se
 * guarda en Supabase y se dibuja en el gráfico. Debajo, todas las guardadas
 * (de este ticker o de todos) con su resultado frente a lo que pasó de verdad:
 * pulsar una la dibuja.
 */

const signed = (value: number, digits = 2) => `${value >= 0 ? '+' : ''}${value.toFixed(digits)}%`;

function finalMove(prediction: AiPrediction): number | null {
  const last = prediction.points[prediction.points.length - 1];
  return last ? (last.p / prediction.anchor - 1) * 100 : null;
}

function scoreText(score: PredictionScore | null): string {
  if (!score || score.evaluated === 0) return 'sin evaluar aún';
  const parts = [`${score.evaluated}/${score.total} pts`];
  if (score.maePct !== null) parts.push(`error medio ${score.maePct.toFixed(2)}%`);
  if (score.directionHit !== null) parts.push(`dirección ${score.directionHit ? '✓' : '✗'}`);
  return parts.join(' · ');
}

const todayEt = () => etParts(Date.now() / 1000).date;

export default function AiPredictionPanel() {
  const { ticker, aiPrediction, setAiPrediction, setTicker } = useTradingStore();
  const [all, setAll] = useState(false);
  const { predictions, listError, loading, generating, generateError, generate, reload } = useAiPredictions(ticker, all);
  const [startedAt, setStartedAt] = useState(0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!generating) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [generating]);

  // Al llegar a un ticker, se dibuja su predicción más reciente de hoy (una vez:
  // si el usuario la oculta, no vuelve a aparecer sola).
  const autoShown = useRef(new Set<string>());
  useEffect(() => {
    if (all || autoShown.current.has(ticker) || aiPrediction?.ticker === ticker) return;
    const latest = predictions.find((item) => item.ticker === ticker && item.sessionDate === todayEt());
    if (latest) {
      autoShown.current.add(ticker);
      setAiPrediction(latest);
    }
  }, [predictions, ticker, all, aiPrediction, setAiPrediction]);

  // Mantiene la predicción dibujada al día con su resultado cuando la lista se relee.
  useEffect(() => {
    if (!aiPrediction) return;
    const fresh = predictions.find((item) => item.id === aiPrediction.id);
    if (fresh && fresh.score !== aiPrediction.score) setAiPrediction(fresh);
  }, [predictions, aiPrediction, setAiPrediction]);

  const onGenerate = async () => {
    setStartedAt(Date.now());
    setNow(Date.now());
    const prediction = await generate();
    if (prediction) {
      autoShown.current.add(prediction.ticker);
      setAiPrediction(prediction);
    }
  };

  const onSelect = (prediction: AiPrediction) => {
    if (prediction.ticker !== ticker) setTicker(prediction.ticker);
    autoShown.current.add(prediction.ticker);
    setAiPrediction(prediction);
  };

  const shown = aiPrediction && aiPrediction.ticker === ticker ? aiPrediction : null;
  const move = shown ? finalMove(shown) : null;

  return (
    <section className="ai-prediction">
      <header className="ai-prediction__header">
        <h3>Predicción IA de la sesión · {ticker}</h3>
        <div className="ai-prediction__actions">
          <button type="button" className="ai-prediction__generate" onClick={onGenerate} disabled={generating}>
            {generating ? `Generando… ${Math.round((now - startedAt) / 1000)} s` : '✨ Generar predicción con IA'}
          </button>
          <button type="button" onClick={reload} disabled={loading} title="Releer las guardadas">
            ↻
          </button>
        </div>
      </header>

      {generating && (
        <p className="news-agent__muted">
          Reuniendo velas, indicadores, precio web, noticias, ecosistema, modelos de ML e historial, y esperando a DeepSeek (suele tardar 20–60 s).
        </p>
      )}
      {generateError && <p className="news-agent__warning">No se generó: {generateError}</p>}

      {shown ? (
        <div className="ai-prediction__card">
          <p className="ai-prediction__headline">
            <span className={`ai-prediction__bias is-${shown.bias}`}>{shown.bias}</span>
            <span>confianza {shown.confidence}%</span>
            <span>
              ${shown.anchor.toFixed(2)} ({etHHMM(shown.asOf)} ET) → $
              {shown.points[shown.points.length - 1]?.p.toFixed(2)} a las 16:00
              {move !== null && ` (${signed(move)})`}
            </span>
            <button type="button" onClick={() => setAiPrediction(null)}>
              Ocultar del gráfico
            </button>
          </p>
          {shown.reasoning && <p className="news-agent__summary">{shown.reasoning}</p>}
          {shown.keyLevels.length > 0 && (
            <p className="news-agent__risks">
              <strong>Niveles clave:</strong> {shown.keyLevels.join(' · ')}
            </p>
          )}
          <p className="news-agent__data">Resultado real: {scoreText(shown.score)}</p>
          <p className="news-agent__muted">
            Sesión {shown.sessionDate} · generada {etHHMM(Date.parse(shown.createdAt))} ET · {shown.model} · contexto: {shown.sources.join(', ') || 'n/d'}
            {shown.failures.length > 0 && ` · sin datos: ${shown.failures.join(' · ')}`}
          </p>
        </div>
      ) : (
        <p className="news-agent__muted">
          Ninguna predicción dibujada para {ticker}. Genera una o elige una guardada; se ve en el gráfico (1m, 5m, 15m o 1h) como una línea rosa punteada «IA».
        </p>
      )}

      <div className="ai-prediction__list-head">
        <strong>Guardadas</strong>
        <div className="ai-chain__metrics">
          <button type="button" className={!all ? 'is-active' : ''} onClick={() => setAll(false)}>
            {ticker}
          </button>
          <button type="button" className={all ? 'is-active' : ''} onClick={() => setAll(true)}>
            Todos
          </button>
        </div>
      </div>

      {listError && <p className="news-agent__warning">{listError}</p>}
      {!listError && predictions.length === 0 && !loading && <p className="news-agent__muted">Aún no hay predicciones guardadas.</p>}

      {predictions.length > 0 && (
        <div className="ai-prediction__table">
          <table>
            <thead>
              <tr>
                <th>Sesión</th>
                <th>Hora</th>
                <th>Ticker</th>
                <th>Sesgo</th>
                <th>Conf.</th>
                <th>Ancla → 16:00</th>
                <th>Resultado</th>
              </tr>
            </thead>
            <tbody>
              {predictions.map((item) => {
                const itemMove = finalMove(item);
                return (
                  <tr
                    key={item.id}
                    className={item.id === aiPrediction?.id ? 'is-active' : ''}
                    onClick={() => onSelect(item)}
                    title="Dibujar en el gráfico"
                  >
                    <td>{item.sessionDate}</td>
                    <td>{etHHMM(item.asOf)}</td>
                    <td>{item.ticker}</td>
                    <td className={`ai-prediction__bias-text is-${item.bias}`}>{item.bias}</td>
                    <td>{item.confidence}%</td>
                    <td>
                      ${item.anchor.toFixed(2)} → ${item.points[item.points.length - 1]?.p.toFixed(2)}
                      {itemMove !== null && ` (${signed(itemMove, 1)})`}
                    </td>
                    <td>{scoreText(item.score)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
