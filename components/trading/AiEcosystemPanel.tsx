'use client';

import { useEffect, useState } from 'react';
import { useTradingStore } from '@/lib/trading/tradingStore';
import { useAiEcosystem } from '@/lib/trading/useAiEcosystem';
import { AI_CHAIN } from '@/lib/trading/aiEcosystem/chain';
import { linkAverage, moveColor, type MoveMetric, type TickerMove } from '@/lib/trading/aiEcosystem/moves';
import { etClock } from '@/lib/trading/newsAgent/format';

/**
 * Cadena de valor de la IA, de la energía a los hyperscalers.
 *
 * Siempre a la vista, una línea resumen con el % medio de cada eslabón. El
 * diagrama completo (una columna por eslabón, una casilla por ticker coloreada
 * por su movimiento) se despliega con el marcador «Ver diagrama». Pulsar una
 * casilla la carga en el gráfico.
 */

const OPEN_KEY = 'trading-lab:ai-chain-open';

/** A partir de este %, el color ya está saturado: 3 % en el día es mucho; en 5 min, 0.5 % ya lo es. */
const METRICS: { id: MoveMetric; label: string; scale: number }[] = [
  { id: 'change1d', label: 'Día', scale: 3 },
  { id: 'change15m', label: '15 min', scale: 1 },
  { id: 'change5m', label: '5 min', scale: 0.5 },
];

const signed = (value: number | null) => (value === null ? 'n/d' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`);

function Sparkline({ points, baseline }: { points: number[]; baseline: number | null }) {
  if (points.length < 2) return null;

  const values = baseline === null ? points : [...points, baseline];
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const y = (value: number) => (28 - ((value - min) / span) * 26).toFixed(1);
  const x = (i: number) => ((i / (points.length - 1)) * 100).toFixed(1);

  return (
    <svg className="ai-chain__spark" viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden>
      {baseline !== null && <line x1="0" x2="100" y1={y(baseline)} y2={y(baseline)} className="ai-chain__baseline" />}
      <polyline points={points.map((value, i) => `${x(i)},${y(value)}`).join(' ')} />
    </svg>
  );
}

function Tile({ ticker, name, move, metric, scale, active, onSelect }: {
  ticker: string;
  name: string;
  move: TickerMove | null | undefined;
  metric: MoveMetric;
  scale: number;
  active: boolean;
  onSelect: () => void;
}) {
  const change = move ? move[metric] : null;

  return (
    <button
      type="button"
      className={`ai-chain__tile${active ? ' is-active' : ''}`}
      style={{ background: moveColor(change, scale) }}
      onClick={onSelect}
      title={
        move
          ? `${name} · $${move.price.toFixed(2)} · día ${signed(move.change1d)} · 15 min ${signed(move.change15m)} · 5 min ${signed(move.change5m)} · última barra ${etClock(move.time)}`
          : `${name} · sin datos`
      }
    >
      <span className="ai-chain__ticker">{ticker}</span>
      <span className="ai-chain__change">{signed(change)}</span>
      {move && <Sparkline points={move.sparkline} baseline={move.prevClose} />}
    </button>
  );
}

export default function AiEcosystemPanel() {
  const { ticker, setTicker } = useTradingStore();
  const { moves, failures, generatedAt, error, loading } = useAiEcosystem();
  const [metric, setMetric] = useState<MoveMetric>('change1d');
  const [open, setOpen] = useState(false);

  // localStorage solo existe en el navegador: se lee tras montar para no romper la hidratación.
  useEffect(() => {
    try {
      setOpen(window.localStorage.getItem(OPEN_KEY) === '1');
    } catch {
      /* sin almacenamiento: empieza plegado */
    }
  }, []);

  const toggle = () => {
    setOpen((current) => {
      try {
        window.localStorage.setItem(OPEN_KEY, current ? '0' : '1');
      } catch {
        /* modo privado: no se recuerda, nada más */
      }
      return !current;
    });
  };

  const averages = AI_CHAIN.map((link) => linkAverage(link.tickers.map((entry) => moves[entry.ticker]?.[metric] ?? null)));

  const { scale } = METRICS.find((entry) => entry.id === metric)!;
  const lastBar = Object.values(moves).reduce((latest, move) => Math.max(latest, move?.time ?? 0), 0);

  return (
    <section className="ai-chain">
      <header className="ai-chain__header">
        <h3>
          Ecosistema IA · de la energía a los hyperscalers
          {lastBar > 0 && ` · última barra ${etClock(lastBar)} (~15 min de retraso)`}
          {loading && ' · cargando…'}
        </h3>
        <div className="ai-chain__metrics">
          <button type="button" className={`ai-chain__toggle${open ? ' is-active' : ''}`} onClick={toggle} aria-expanded={open}>
            {open ? '▾ Ocultar diagrama' : '▸ Ver diagrama'}
          </button>
          {METRICS.map((entry) => (
            <button key={entry.id} type="button" className={entry.id === metric ? 'is-active' : ''} onClick={() => setMetric(entry.id)}>
              {entry.label}
            </button>
          ))}
        </div>
      </header>

      {error && <p className="news-agent__warning">Sin datos del ecosistema: {error}</p>}

      <ol className="ai-chain__summary" aria-label="Resumen por eslabón">
        {AI_CHAIN.map((link, index) => (
          <li key={link.id} style={{ background: moveColor(averages[index], scale) }} title={link.tickers.map((entry) => entry.ticker).join(' · ')}>
            <span>{link.label}</span>
            <strong>{signed(averages[index])}</strong>
          </li>
        ))}
      </ol>

      {open && (
        <div className="ai-chain__links">
          {AI_CHAIN.map((link, index) => {
            const average = averages[index];

            return (
              <div key={link.id} className="ai-chain__link">
                <div className="ai-chain__link-head" style={{ background: moveColor(average, scale) }}>
                  <span>
                    {index + 1}. {link.label}
                  </span>
                  <strong>{signed(average)}</strong>
                </div>
                {link.tickers.map((entry) => (
                  <Tile
                    key={entry.ticker}
                    ticker={entry.ticker}
                    name={entry.name}
                    move={moves[entry.ticker]}
                    metric={metric}
                    scale={scale}
                    active={entry.ticker === ticker}
                    onSelect={() => setTicker(entry.ticker)}
                  />
                ))}
              </div>
            );
          })}
        </div>
      )}

      {generatedAt && failures.length > 0 && (
        <p className="news-agent__muted">Sin datos nuevos: {failures.join(' · ')}</p>
      )}
    </section>
  );
}
