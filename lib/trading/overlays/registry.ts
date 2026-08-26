import type { TickerCapabilities } from '@/types/trading';

/**
 * Catalogue of everything that can be drawn on the Trading Lab chart.
 *
 * `source` says where the data comes from — 'local' is computed from the
 * candles already in memory, everything else is one call to the ML API. Note
 * that several overlays share a source: /patterns returns S/R, breakouts, FVG,
 * order blocks and liquidity in one response, and /technical returns ZigZag,
 * Elliott, Fibonacci and the moving averages together. Fetching is keyed by
 * source, so enabling both Fibonacci and ZigZag costs one request, not two.
 */

export type OverlaySource = 'local' | 'xgb' | 'mlp' | 'extended' | 'forecast' | 'session' | 'technical' | 'patterns';

export type OverlayId =
  | 'ema'
  | 'vwap'
  | 'bollinger'
  | 'openingRange'
  | 'prevDay'
  | 'sessions'
  | 'levels'
  | 'zones'
  | 'priceAction'
  | 'xgb'
  | 'mlp'
  | 'extended'
  | 'montecarlo'
  | 'sessionCurve'
  | 'fibonacci'
  | 'zigzag'
  | 'sma';

export type OverlayGroup = 'Indicadores' | 'Day trading' | 'Estructura' | 'Curvas predictivas';

export type OverlayDef = {
  id: OverlayId;
  label: string;
  group: OverlayGroup;
  source: OverlaySource;
  hint: string;
  /** Timeframes where the overlay means anything. Omitted = every timeframe. */
  timeframes?: string[];
  /** Trained model the overlay depends on. */
  capability?: keyof TickerCapabilities;
};

const INTRADAY = ['1m', '5m', '15m', '1h'];

export const OVERLAYS: OverlayDef[] = [
  { id: 'ema', label: 'EMA 20/50', group: 'Indicadores', source: 'local', hint: 'Medias exponenciales sobre las velas cargadas' },
  { id: 'vwap', label: 'VWAP + bandas', group: 'Indicadores', source: 'local', timeframes: INTRADAY, hint: 'VWAP anclado a la sesión con bandas ±1σ y ±2σ' },
  { id: 'bollinger', label: 'Bollinger 20', group: 'Indicadores', source: 'local', hint: 'Bandas de Bollinger de 20 periodos' },

  { id: 'openingRange', label: 'Opening Range (15m)', group: 'Day trading', source: 'local', timeframes: INTRADAY, hint: 'Rango de los primeros 15 min y su ruptura' },
  { id: 'prevDay', label: 'Niveles día previo', group: 'Day trading', source: 'local', timeframes: INTRADAY, hint: 'PDH / PDL / PDC de la sesión anterior' },
  { id: 'sessions', label: 'Sesiones', group: 'Day trading', source: 'local', timeframes: INTRADAY, hint: 'Sombreado de premarket y after-hours' },

  { id: 'levels', label: 'Soportes y resistencias', group: 'Estructura', source: 'patterns', timeframes: INTRADAY, hint: 'Clustering de pivotes con nº de toques + breakouts con volumen' },
  { id: 'zones', label: 'FVG · Order blocks · Liquidez', group: 'Estructura', source: 'patterns', timeframes: INTRADAY, hint: 'Huecos de valor, bloques institucionales y barridos de liquidez' },
  { id: 'priceAction', label: 'Patrones de vela', group: 'Estructura', source: 'patterns', timeframes: INTRADAY, hint: 'Martillo, shooting star, doji y envolventes (los que detecta intraday.py)' },

  { id: 'xgb', label: 'Curva XGBoost', group: 'Curvas predictivas', source: 'xgb', timeframes: ['1d'], capability: 'xgb', hint: 'Predicción recursiva diaria del modelo principal' },
  { id: 'mlp', label: 'Curva MLP', group: 'Curvas predictivas', source: 'mlp', timeframes: ['1d'], capability: 'mlp', hint: 'Predicción de la red neuronal' },
  { id: 'extended', label: 'Curva extendida (AH+PM)', group: 'Curvas predictivas', source: 'extended', timeframes: ['1d'], capability: 'extended', hint: 'Modelo con after-hours y premarket; su ventaja está en el día 1' },
  { id: 'montecarlo', label: 'Bandas Monte Carlo', group: 'Curvas predictivas', source: 'forecast', timeframes: ['1d'], capability: 'xgb', hint: 'Rango de riesgo P5–P95 y P25–P75 sobre 10 000 trayectorias' },
  { id: 'sessionCurve', label: 'Curva de sesión (15m)', group: 'Curvas predictivas', source: 'session', timeframes: ['15m'], capability: 'intraday', hint: 'Resto de la sesión hasta las 16:00 ET' },
  { id: 'fibonacci', label: 'Fibonacci', group: 'Curvas predictivas', source: 'technical', timeframes: ['1d'], capability: 'xgb', hint: 'Retrocesos y extensiones del swing dominante' },
  { id: 'zigzag', label: 'ZigZag + Elliott', group: 'Curvas predictivas', source: 'technical', timeframes: ['1d'], capability: 'xgb', hint: 'Estructura de swings y conteo de ondas (experimental)' },
  { id: 'sma', label: 'SMA 20/50/200', group: 'Curvas predictivas', source: 'technical', timeframes: ['1d'], capability: 'xgb', hint: 'Medias simples calculadas por la API' },
];

export const OVERLAY_GROUPS: OverlayGroup[] = ['Indicadores', 'Day trading', 'Estructura', 'Curvas predictivas'];

export type OverlayState = Record<OverlayId, boolean>;

export const DEFAULT_OVERLAYS: OverlayState = {
  ema: true,
  vwap: true,
  bollinger: false,
  openingRange: false,
  prevDay: false,
  sessions: false,
  levels: false,
  zones: false,
  priceAction: false,
  xgb: false,
  mlp: false,
  extended: false,
  montecarlo: false,
  sessionCurve: false,
  fibonacci: false,
  zigzag: false,
  sma: false,
};

/** Why an overlay cannot be shown right now, or null when it can. */
export function blockedReason(
  overlay: OverlayDef,
  timeframe: string,
  capabilities: TickerCapabilities | null,
  apiReachable: boolean
): string | null {
  if (overlay.timeframes && !overlay.timeframes.includes(timeframe)) {
    return `Solo en ${overlay.timeframes.join(' / ')}`;
  }

  if (overlay.source === 'local') return null;

  if (!apiReachable) return 'API de ML no disponible';

  if (overlay.capability && capabilities && !capabilities[overlay.capability]) {
    return 'Sin modelo entrenado para este ticker';
  }

  return null;
}
