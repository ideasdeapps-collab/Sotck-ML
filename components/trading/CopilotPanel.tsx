'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTradingStore } from '@/lib/trading/tradingStore';
import { calculateIndicators } from '@/lib/trading/indicators';
import { useIntradayStructure } from '@/lib/trading/dayTrading/useIntradayStructure';
import { copilot, useCopilot } from '@/lib/trading/copilot/store';
import { closeAllCopilotPositions, isRunning, runTick } from '@/lib/trading/copilot/engine';
import { llmUsage } from '@/lib/trading/copilot/llm';
import { calculatePnL, ownedBy, usePortfolio } from '@/lib/trading/paperEngine';
import { fetchJson } from '@/lib/trading/fetchJson';
import type { Candle } from '@/lib/trading/marketData';
import type { CopilotEvent } from '@/lib/trading/copilot/types';

/**
 * El copiloto: un click lo enciende y a partir de ahí opera la cuenta simulada
 * con los setups que el propio Lab calcula.
 *
 * Este componente no decide nada. Es el que tiene las velas a mano, así que es
 * el que llama a `runTick` en cada refresco — el stream de velas es el reloj —
 * y el que enseña lo que el motor decidió y por qué.
 *
 * ⚠️ Cuenta simulada con fines educativos. No es una recomendación de inversión.
 */

type LlmStatus = { available: boolean; model: string; reason: string };

const money = (value: number) =>
  value.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });

const clock = (at: number) =>
  new Date(at).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const KIND_LABEL: Record<CopilotEvent['kind'], string> = {
  open: 'Apertura',
  close: 'Cierre',
  skip: 'Descartada',
  blocked: 'Bloqueada',
  error: 'Aviso',
};

export default function CopilotPanel() {
  const {
    ticker,
    timeframe,
    candles,
    capital,
    riskPerTrade,
    planBias,
    dataSource,
  } = useTradingStore();

  const state = useCopilot();
  const portfolio = usePortfolio();
  const { intraday } = useIntradayStructure(ticker, timeframe);
  const [llm, setLlm] = useState<LlmStatus | null>(null);

  /** Precio del tick anterior: los cruces de stop y objetivo se miden ahí. */
  const previousPriceRef = useRef(0);

  // --- ¿Hay clave de OpenAI? ----------------------------------------------
  useEffect(() => {
    let cancelled = false;

    fetchJson('/api/copilot')
      .then((data) => {
        if (!cancelled) setLlm(data);
      })
      .catch((error) => {
        if (!cancelled) {
          setLlm({ available: false, model: '', reason: error?.message || 'No se pudo comprobar OpenAI' });
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  // --- El tick ------------------------------------------------------------
  useEffect(() => {
    if (!state.enabled) {
      previousPriceRef.current = 0;
      return;
    }

    const series = candles as Candle[];
    const last = series[series.length - 1];
    if (!last) return;

    // Un tick anterior sigue esperando a GPT. Salir sin mover la referencia:
    // avanzarla aquí perdería el tramo de precio que ese tick no llegó a mirar,
    // y con él un stop o un objetivo que se cruzó por el camino.
    if (isRunning()) return;

    // El primer tick tras encender no tiene precio anterior, así que no puede
    // detectar ningún cruce: se toma el actual y se empieza a medir desde ahí.
    const previousPrice = previousPriceRef.current || last.close;
    previousPriceRef.current = last.close;

    void runTick({
      ticker,
      timeframe,
      candles: series,
      indicators: calculateIndicators(series),
      intraday,
      bias: planBias,
      dataSource,
      capital,
      riskPerTrade,
      previousPrice,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [candles, state.enabled, ticker, timeframe, intraday, planBias, dataSource, capital, riskPerTrade]);

  // --- Posición viva -------------------------------------------------------
  const position = useMemo(() => ownedBy(portfolio, 'copilot', ticker)[0] ?? null, [portfolio, ticker]);

  const lastPrice = (candles as Candle[])[candles.length - 1]?.close ?? 0;
  const openPnl = position && lastPrice ? calculatePnL(position, lastPrice) : 0;

  const usage = llmUsage();
  const withLlm = state.config.useLlm && llm?.available === true;
  const lossLimit = capital * state.config.maxDailyLossPct;

  function toggle() {
    copilot.setEnabled(!state.enabled);
  }

  function panic() {
    copilot.setEnabled(false);
    if (lastPrice) closeAllCopilotPositions({ [ticker]: lastPrice });
  }

  return (
    <section className="copilot">
      <header className="copilot__header">
        <h3>Copiloto · paper trading</h3>
        <button
          type="button"
          className={`copilot__toggle ${state.enabled ? 'is-on' : ''}`}
          onClick={toggle}
        >
          {state.enabled ? 'ACTIVO — parar' : 'ACTIVAR COPILOTO'}
        </button>
      </header>

      <p className="copilot__mode">
        {llm === null
          ? 'Comprobando OpenAI…'
          : withLlm
            ? `Reglas + GPT (${llm.model}) · ${usage.calls}/${usage.max} consultas en esta sesión`
            : `Solo reglas — ${state.config.useLlm ? llm.reason : 'veredicto de GPT desactivado'}`}
      </p>

      {dataSource === 'demo' && (
        <p className="copilot__warning">
          Velas simuladas: el copiloto no operará hasta que configures POLYGON_API_KEY.
        </p>
      )}

      {/* --- Guardarraíles --- */}
      <h4>Guardarraíles</h4>
      <div className="copilot__config">
        <label>
          Operaciones/día
          <input
            type="number"
            min={1}
            max={20}
            value={state.config.maxTradesPerDay}
            onChange={(event) =>
              copilot.setConfig({ maxTradesPerDay: Math.max(1, Number(event.target.value) || 1) })
            }
          />
        </label>
        <label>
          Pérdida máx. diaria %
          <input
            type="number"
            min={0.1}
            max={20}
            step={0.1}
            value={+(state.config.maxDailyLossPct * 100).toFixed(1)}
            onChange={(event) =>
              copilot.setConfig({
                maxDailyLossPct: Math.max(0.001, (Number(event.target.value) || 0) / 100),
              })
            }
          />
        </label>
        <label>
          Enfriamiento (min)
          <input
            type="number"
            min={0}
            max={120}
            value={state.config.cooldownMinutes}
            onChange={(event) =>
              copilot.setConfig({ cooldownMinutes: Math.max(0, Number(event.target.value) || 0) })
            }
          />
        </label>
        <label>
          Confianza mín. GPT %
          <input
            type="number"
            min={0}
            max={100}
            value={state.config.minLlmConfidence}
            disabled={!state.config.useLlm}
            onChange={(event) =>
              copilot.setConfig({
                minLlmConfidence: Math.min(100, Math.max(0, Number(event.target.value) || 0)),
              })
            }
          />
        </label>
        <label className="copilot__check">
          <input
            type="checkbox"
            checked={state.config.useLlm}
            onChange={(event) => copilot.setConfig({ useLlm: event.target.checked })}
          />
          Consultar a GPT antes de operar
        </label>
      </div>

      {/* --- Estado del día --- */}
      <dl className="copilot__stats">
        <div>
          <dt>Operaciones hoy</dt>
          <dd>
            {state.tradesToday} / {state.config.maxTradesPerDay}
          </dd>
        </div>
        <div>
          <dt>Resultado hoy</dt>
          <dd className={state.realisedToday < 0 ? 'is-bearish' : 'is-bullish'}>
            {money(state.realisedToday)}
          </dd>
        </div>
        <div>
          <dt>Límite de pérdida</dt>
          <dd>{money(-lossLimit)}</dd>
        </div>
      </dl>

      {/* --- Posición viva --- */}
      <h4>Posición del copiloto</h4>
      {position ? (
        <p className="copilot__position">
          <strong className={position.side === 'long' ? 'is-bullish' : 'is-bearish'}>
            {position.side === 'long' ? 'COMPRA' : 'VENTA'}
          </strong>{' '}
          {position.shares} {position.ticker} @ {position.entry.toFixed(2)} · SL {position.stop.toFixed(2)} · TP{' '}
          {position.target.toFixed(2)}
          {position.target2 !== undefined ? ` / ${position.target2.toFixed(2)}` : ''}
          <span className={openPnl < 0 ? 'is-bearish' : 'is-bullish'}> · {money(openPnl)}</span>
        </p>
      ) : (
        <p className="signals-panel__quiet">Sin posición abierta en {ticker}.</p>
      )}

      {/* --- Registro --- */}
      <div className="copilot__log-header">
        <h4>Registro de decisiones</h4>
        {state.events.length > 0 && (
          <button type="button" className="copilot__link" onClick={() => copilot.clearEvents()}>
            limpiar
          </button>
        )}
      </div>

      {state.events.length === 0 ? (
        <p className="signals-panel__quiet">
          Aún no ha decidido nada. Con el copiloto activo, aquí queda escrito todo lo que hace y por qué
          — incluidas las operaciones que descarta.
        </p>
      ) : (
        <ul className="copilot__log">
          {state.events.slice(0, 20).map((event) => (
            <li key={event.id} data-kind={event.kind}>
              <header>
                <span className="copilot__log-kind">{KIND_LABEL[event.kind]}</span>
                <span className="copilot__log-time">
                  {clock(event.at)} · {event.ticker}
                </span>
              </header>
              <p className="copilot__log-headline">
                {event.headline}
                {event.pnl !== undefined && (
                  <span className={event.pnl < 0 ? 'is-bearish' : 'is-bullish'}> · {money(event.pnl)}</span>
                )}
              </p>
              {event.llm && (
                <p className="copilot__log-llm">
                  GPT · {event.llm.verdict} ({event.llm.confidence}%) — {event.llm.rationale}
                </p>
              )}
              <ul className="copilot__log-reasons">
                {event.reasons.map((reason, index) => (
                  <li key={index}>{reason}</li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}

      <button type="button" className="copilot__panic" onClick={panic} disabled={!state.enabled && !position}>
        Parar y cerrar todo a mercado
      </button>

      <p className="copilot__disclaimer">
        Cuenta simulada con fines educativos, basada en reglas. No es una recomendación de inversión.
      </p>
    </section>
  );
}
