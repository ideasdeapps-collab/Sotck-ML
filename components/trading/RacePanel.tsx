'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTradingStore } from '@/lib/trading/tradingStore';
import { useRace } from '@/lib/trading/useRace';
import { AI_CHAIN } from '@/lib/trading/aiEcosystem/chain';
import { RACE_MINUTES, RACE_MODES, parseTickerList, raceScale, rankAt, type RaceMode } from '@/lib/trading/race/race';
import { etClock } from '@/lib/trading/newsAgent/format';

/**
 * Carrera de tickers al estilo del «Stock Race» de Trade Ideas.
 *
 * Un carril por ticker; el coche avanza a la derecha si sube y a la izquierda
 * si baja desde la salida, y los carriles se reordenan según quién va ganando.
 * - Día (por defecto): la salida es el cierre anterior; con cada minuto nuevo
 *   los coches avanzan a su «% del día» actual. ▶ Repetir reproduce el día.
 * - 5 min: la salida es hace 5 min y cada dato nuevo reproduce esos 5 minutos. Por defecto corre la columna de memoria del ecosistema IA; se puede
 * elegir otra columna o escribir una lista propia.
 */

const CUSTOM = 'custom';
const DEFAULT_SOURCE = 'memory';
const FRAME_MS = 700;
/** La repetición del día dura unos 12 s, sea cual sea la hora. */
const DAY_REPLAY_MS = 12_000;
/** En el día, el rastro solo enseña los últimos minutos: 390 puntos por carril serían ruido. */
const DAY_TRAIL = 15;
const MODE_LABEL: Record<RaceMode, string> = { day: 'Día', '5m': `${RACE_MINUTES} min` };
const LANE_PX = 34;

const STORAGE = { source: 'trading-lab:race-source', custom: 'trading-lab:race-custom', mode: 'trading-lab:race-mode' };

/** Preferencia de este navegador; sin almacenamiento disponible, el panel funciona igual. */
function readStored(key: string, fallback: string): string {
  try {
    return window.localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function writeStored(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    /* modo privado o almacenamiento bloqueado: no se recuerda, nada más */
  }
}

const signed = (value: number | null) => (value === null ? 'n/d' : `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`);

export default function RacePanel() {
  const { ticker: selected, setTicker } = useTradingStore();

  const [mode, setMode] = useState<RaceMode>('day');
  const [source, setSource] = useState(DEFAULT_SOURCE);
  const [customText, setCustomText] = useState('');
  const [appliedCustom, setAppliedCustom] = useState('');

  // localStorage solo existe en el navegador: se lee tras montar para no romper la hidratación.
  useEffect(() => {
    setMode(readStored(STORAGE.mode, 'day') === '5m' ? '5m' : 'day');
    const stored = readStored(STORAGE.source, DEFAULT_SOURCE);
    setSource(stored === CUSTOM || AI_CHAIN.some((link) => link.id === stored) ? stored : DEFAULT_SOURCE);
    const custom = readStored(STORAGE.custom, 'NVDA, AMD, AVGO, MU, TSM');
    setCustomText(custom);
    setAppliedCustom(custom);
  }, []);

  // La lista propia se aplica 600 ms después de la última tecla, no con cada una.
  useEffect(() => {
    const id = setTimeout(() => setAppliedCustom(customText), 600);
    return () => clearTimeout(id);
  }, [customText]);

  const tickers = useMemo(() => {
    if (source === CUSTOM) return parseTickerList(appliedCustom);
    const link = AI_CHAIN.find((entry) => entry.id === source) ?? AI_CHAIN.find((entry) => entry.id === DEFAULT_SOURCE)!;
    return link.tickers.map((entry) => entry.ticker);
  }, [source, appliedCustom]);

  const { race, failures, generatedAt, error, loading } = useRace(tickers, mode);

  const [frame, setFrame] = useState(0);
  const [replayKey, setReplayKey] = useState(0);
  const lastFrame = Math.max(0, (race?.frames.length ?? 1) - 1);
  const player = useRef<ReturnType<typeof setInterval> | undefined>(undefined);

  /** Reproduce desde la salida hasta la última foto, un minuto por paso. */
  const play = (stepMs: number) => {
    clearInterval(player.current);
    setFrame(0);
    const id = setInterval(() => {
      setFrame((current) => {
        if (current >= lastFrame) {
          clearInterval(id);
          return current;
        }
        return current + 1;
      });
    }, stepMs);
    player.current = id;
  };

  // Dato nuevo: en el día los coches avanzan a la foto actual (la transición CSS
  // hace el movimiento); en 5 min se reproduce la carrera entera.
  useEffect(() => {
    if (mode === 'day') {
      clearInterval(player.current);
      setFrame(lastFrame);
    } else {
      play(FRAME_MS);
    }
    return () => clearInterval(player.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [generatedAt, lastFrame, mode]);

  useEffect(() => {
    if (replayKey > 0) play(mode === 'day' ? Math.max(20, DAY_REPLAY_MS / Math.max(1, lastFrame)) : FRAME_MS);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [replayKey]);

  const lanes = race?.lanes ?? [];
  const order = rankAt(lanes, frame);
  const scale = raceScale(lanes);
  const frameTime = race?.frames[frame];
  const trailFrom = mode === 'day' ? Math.max(0, frame - DAY_TRAIL) : 0;

  const onMode = (value: RaceMode) => {
    setMode(value);
    writeStored(STORAGE.mode, value);
  };

  const onSource = (value: string) => {
    setSource(value);
    writeStored(STORAGE.source, value);
  };

  const onCustom = (value: string) => {
    setCustomText(value);
    writeStored(STORAGE.custom, value);
  };

  return (
    <section className="race">
      <header className="race__header">
        <h3>
          {mode === 'day' ? 'Carrera del día' : `Carrera ${RACE_MINUTES} min`}
          {frameTime !== undefined &&
            (mode === 'day' && frame === lastFrame ? ` · ${etClock(frameTime)}` : ` · minuto ${frame}/${lastFrame} · ${etClock(frameTime)}`)}
          {loading && ' · cargando…'}
        </h3>
        <div className="race__controls">
          {RACE_MODES.map((entry) => (
            <button key={entry} type="button" className={entry === mode ? 'is-active' : ''} onClick={() => onMode(entry)}>
              {MODE_LABEL[entry]}
            </button>
          ))}
          <select value={source} onChange={(event) => onSource(event.target.value)}>
            {AI_CHAIN.map((link) => (
              <option key={link.id} value={link.id}>
                {link.label}
              </option>
            ))}
            <option value={CUSTOM}>Personalizada…</option>
          </select>
          <button type="button" onClick={() => setReplayKey((key) => key + 1)} disabled={!race?.frames.length}>
            ▶ Repetir
          </button>
        </div>
      </header>

      {source === CUSTOM && (
        <input
          className="race__custom"
          value={customText}
          onChange={(event) => onCustom(event.target.value)}
          placeholder="Tickers separados por comas, hasta 12 (p. ej. NVDA, AMD, MU)"
          spellCheck={false}
        />
      )}

      {error && <p className="news-agent__warning">Sin carrera: {error}</p>}

      {lanes.length > 0 && (
        <div className="race__track" style={{ height: lanes.length * LANE_PX }}>
          <div className="race__zero" />
          {lanes.map((lane) => {
            const rank = order.indexOf(lane.ticker);
            const value = lane.path[frame] ?? null;
            const position = (value: number) => `${50 + (value / scale) * 44}%`;

            return (
              <div
                key={lane.ticker}
                className={`race__lane${lane.ticker === selected ? ' is-active' : ''}`}
                style={{ transform: `translateY(${rank * LANE_PX}px)` }}
              >
                <button type="button" className="race__label" onClick={() => setTicker(lane.ticker)} title="Ver en el gráfico">
                  <span className="race__rank">{rank + 1}</span>
                  {lane.ticker}
                </button>
                <div className="race__road">
                  {lane.path.slice(trailFrom, frame).map((past, i) =>
                    past === null ? null : <i key={trailFrom + i} className="race__trail" style={{ left: position(past) }} />
                  )}
                  {value !== null && (
                    <span className={`race__car ${value >= 0 ? 'is-up' : 'is-down'}`} style={{ left: position(value) }}>
                      {signed(value)}
                    </span>
                  )}
                </div>
                <span className="race__price">{lane.price !== null ? `$${lane.price.toFixed(2)}` : 'n/d'}</span>
              </div>
            );
          })}
        </div>
      )}

      {generatedAt && failures.length > 0 && <p className="news-agent__muted">Sin datos: {failures.join(' · ')}</p>}
      <p className="news-agent__muted">
        {mode === 'day'
          ? `Salida en el cierre anterior (0 %): la posición es el % del día, una foto por minuto; el rastro son los últimos ${DAY_TRAIL} min.`
          : `Salida hace ${RACE_MINUTES} min (0 %).`}{' '}
        Escala ±{scale.toFixed(2)} %. Barras de 1 min de Polygon con ~15 min de retraso; pulsa un ticker para verlo en el gráfico.
      </p>
    </section>
  );
}
