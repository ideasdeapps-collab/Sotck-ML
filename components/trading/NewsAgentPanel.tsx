'use client';

import { useEffect, useState } from 'react';
import { useTradingStore } from '@/lib/trading/tradingStore';
import { NEWS_REFRESH_MIN_MS, useNewsAgent } from '@/lib/trading/useNewsAgent';
import { countdown, dataLine, etClock } from '@/lib/trading/newsAgent/format';
import type { Headline } from '@/lib/trading/newsAgent/types';

/**
 * Cuadro de texto del agente de noticias, bajo el gráfico.
 *
 * Arriba lo que redacta la IA (Gemini u OpenAI) (sentimiento, emoción, resumen, riesgos); debajo la
 * línea de datos que sale directamente de las fuentes, para que cada cifra del
 * resumen se pueda comprobar; al final los titulares enlazados.
 */

function tone(score: number) {
  if (score >= 20) return 'is-bull';
  if (score <= -20) return 'is-bear';
  return 'is-flat';
}

function HeadlineList({ items }: { items: Headline[] }) {
  return (
    <ul className="news-agent__headlines">
      {items.map((item) => (
        <li key={item.id}>
          <time>{etClock(item.publishedAt)}</time>
          {item.sentiment && <i className={`news-agent__dot is-${item.sentiment}`} title={`Polygon: ${item.sentiment}`} />}
          <a href={item.url} target="_blank" rel="noopener noreferrer">
            {item.title}
          </a>
          <span>{item.source}</span>
        </li>
      ))}
    </ul>
  );
}

export default function NewsAgentPanel() {
  const { ticker } = useTradingStore();
  const { report, error, loading, fetchedAt, nextAt, refresh } = useNewsAgent(ticker);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const canRefresh = !loading && now - fetchedAt >= NEWS_REFRESH_MIN_MS;
  const llm = report?.llm;

  return (
    <section className="news-agent">
      <header className="news-agent__header">
        <h3>
          Agente de noticias · {ticker}
          {report && ` · actualizado ${etClock(report.generatedAt)}`}
          {loading ? ' · buscando…' : nextAt ? ` · próxima en ${countdown(nextAt - now)}` : ''}
        </h3>
        <button
          type="button"
          onClick={refresh}
          disabled={!canRefresh}
          title={canRefresh ? 'Actualizar ahora' : 'Como mucho una actualización por minuto'}
        >
          ↻
        </button>
      </header>

      {error && <p className="news-agent__warning">El agente no respondió: {error}</p>}
      {!report && !error && <p className="news-agent__muted">Buscando noticias de {ticker}…</p>}

      {report && (
        <>
          {llm?.ok ? (
            <>
              <div className={`news-agent__mood ${tone(llm.score)}`}>
                <span>
                  Sentimiento {llm.score > 0 ? '+' : ''}
                  {llm.score} ({llm.emotion})
                </span>
                <div className="news-agent__meter" aria-hidden>
                  <div style={{ left: `${(llm.score + 100) / 2}%` }} />
                </div>
              </div>
              <p className="news-agent__summary">{llm.summary}</p>
              {llm.risks.length > 0 && (
                <p className="news-agent__risks">
                  <strong>Riesgos / catalizadores:</strong> {llm.risks.join(' · ')}
                </p>
              )}
              {llm.note && <p className="news-agent__muted">{llm.note}</p>}
            </>
          ) : (
            <p className="news-agent__warning">Sin resumen de IA: {llm?.reason}</p>
          )}

          <p className="news-agent__data">{dataLine(report.data).join(' · ')}</p>

          {report.failures.length > 0 && (
            <p className="news-agent__muted">Fuentes sin datos: {report.failures.join(' · ')}</p>
          )}

          {report.headlines.length > 0 && (
            <details>
              <summary>Titulares ({report.headlines.length})</summary>
              <HeadlineList items={report.headlines} />
            </details>
          )}
          {report.macro.length > 0 && (
            <details>
              <summary>Geopolítica y macro ({report.macro.length})</summary>
              <HeadlineList items={report.macro} />
            </details>
          )}
        </>
      )}
    </section>
  );
}
