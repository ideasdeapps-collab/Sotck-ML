'use client';

import { useTradingStore } from '@/lib/trading/tradingStore';
import {
  clearJournal,
  entryResult,
  removeEntry,
  useJournal,
  type JournalEntry,
} from '@/lib/trading/dayTrading/journal';

/**
 * What was planned, and what actually happened.
 *
 * Entries are closed by `resolveOpenEntries`, driven from PlanAlerts as the
 * price streams. One consequence worth knowing: only the ticker currently on
 * the chart is being watched, so a trade on another symbol stays open until you
 * go back to it.
 */

const OUTCOME_LABEL: Record<JournalEntry['outcome'], string> = {
  open: 'Abierta',
  tp1: 'TP1',
  tp2: 'TP2',
  stop: 'Stop',
};

const money = (value: number) =>
  `${value >= 0 ? '+' : '−'}$${Math.abs(value).toLocaleString('en-US', { maximumFractionDigits: 0 })}`;

const day = (time: number) =>
  new Date(time).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export default function SessionJournalPanel() {
  const { ticker } = useTradingStore();
  const entries = useJournal();

  const closed = entries.filter((entry) => entry.outcome !== 'open');
  const wins = closed.filter((entry) => entry.outcome !== 'stop').length;
  const totalR = closed.reduce((sum, entry) => sum + (entryResult(entry)?.r ?? 0), 0);
  const totalPnl = closed.reduce((sum, entry) => sum + (entryResult(entry)?.pnl ?? 0), 0);

  return (
    <section className="journal">
      <header className="journal__header">
        <h3>Diario de sesión</h3>
        {entries.length > 0 && (
          <button type="button" onClick={clearJournal}>
            Vaciar
          </button>
        )}
      </header>

      {entries.length === 0 ? (
        <p className="signals-panel__quiet">
          Guarda un plan desde el panel de arriba y aquí verás si acabó en TP o en stop. Se queda en este navegador.
        </p>
      ) : (
        <>
          <p>
            {closed.length} cerradas · {closed.length > 0 ? Math.round((wins / closed.length) * 100) : 0}% aciertos ·{' '}
            {totalR >= 0 ? '+' : ''}
            {totalR.toFixed(2)}R · {money(totalPnl)}
          </p>

          <ul className="journal__rows">
            {entries.map((entry) => {
              const result = entryResult(entry);

              return (
                <li key={entry.id} className={entry.ticker === ticker ? 'is-active' : ''}>
                  <div className="journal__row-head">
                    <b>{entry.ticker}</b>
                    <span className={entry.direction === 'long' ? 'is-bullish' : 'is-bearish'}>
                      {entry.direction === 'long' ? 'COMPRA' : 'VENTA'}
                    </span>
                    <span className={`journal__outcome is-${entry.outcome}`}>{OUTCOME_LABEL[entry.outcome]}</span>
                    <button type="button" onClick={() => removeEntry(entry.id)} aria-label="Eliminar">
                      ×
                    </button>
                  </div>
                  <small>
                    {day(entry.savedAt)} · {entry.timeframe} · entrada {entry.entryMid.toFixed(2)} · SL{' '}
                    {entry.stopLoss.toFixed(2)} · TP {entry.takeProfit[0].toFixed(2)}/
                    {entry.takeProfit[1].toFixed(2)} · {entry.shares} acc.
                    {result && (
                      <b className={result.r >= 0 ? ' is-bullish' : ' is-bearish'}>
                        {' '}
                        {result.r >= 0 ? '+' : ''}
                        {result.r.toFixed(2)}R · {money(result.pnl)}
                      </b>
                    )}
                  </small>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
