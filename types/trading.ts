export type TradeSignal = {
  name: string;
  direction: 'LONG' | 'SHORT' | 'WAIT';
  confidence: number;
  reason: string;
  entry?: number;
  stop?: number;
  targets?: number[];
  riskReward?: number;
};

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

// --------------------------------------------------------------------------
// Responses from the FastAPI ML service (proxied through /api/ml/*).
// Only the fields the Trading Lab actually draws are typed; the API returns
// more (notes, disclaimers, clamp diagnostics) and those pass through as-is.
// --------------------------------------------------------------------------

/** Every ML call resolves to this — the overlays must never throw. */
export type MlResult<T> = { ok: true; data: T } | { ok: false; reason: string };

export type CurvePoint = { date: string; close: number };

/** Shared shape of /predict, /predict-mlp and /predict-extended. */
export type PredictCurve = {
  ticker: string;
  last_close: number;
  last_date: string;
  history: CurvePoint[];
  prediction: CurvePoint[];
  model_meta: Record<string, number | string | null>;
  model?: string;
  reliability?: { reliable: boolean; r2: number; dir_acc: number; warning?: string };
  note?: string;
};

/** Monte Carlo bands — positional arrays aligned with prediction[] by index. */
export type Simulation = {
  ticker: string;
  horizon: number;
  n_sims: number;
  s0: number;
  median: number[];
  mean: number[];
  p5: number[];
  p25: number[];
  p75: number[];
  p95: number[];
  terminal: { median: number; p5: number; p95: number; prob_up: number; expected_return: number };
};

export type ForecastResponse = { prediction: PredictCurve; simulation: Simulation };

export type Pivot = { idx: number; date: string; price: number; type: string };

export type ElliottBundle = {
  zigzag: Pivot[];
  elliott: { found: boolean; points?: { date: string; price: number; label?: string }[]; confidence?: number };
  abc?: { found: boolean; points?: { date: string; price: number; label?: string }[] };
  fibonacci: {
    swing_low?: number;
    swing_high?: number;
    direction?: string;
    retracements?: Record<string, number>;
    extensions?: Record<string, number>;
  };
};

export type TechnicalResponse = PredictCurve &
  ElliottBundle & {
    moving_averages: { sma20: number | null; sma50: number | null; sma200: number | null };
    trendline: { start: { date: string; value: number }; end: { date: string; value: number } } | null;
  };

export type IntradayCandle = {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  vwap?: number;
};

export type Level = { level: number; touches: number };

export type IntradayResponse = {
  ticker: string;
  interval_min: number;
  last_price: number;
  session_vwap: number | null;
  candles_ohlc: IntradayCandle[];
  chartism: {
    support: Level[];
    resistance: Level[];
    structure: { trend: string; last_highs: number[]; last_lows: number[] };
    swing_highs: unknown[];
    swing_lows: unknown[];
    breakouts: { time: string; type: string; level: number; price: number }[];
  };
  price_action: { time: string; pattern: string; bias: string }[];
  elliott: ElliottBundle;
};

export type SessionPrediction = {
  ticker: string;
  session_date: string;
  bars_real: number;
  bars_predicted: number;
  last_real_close: number;
  real: IntradayCandle[];
  predicted: { time: string; close: number; predicted: boolean }[];
  full: { time: string; close: number }[];
  model_meta: Record<string, number>;
  note?: string;
};

export type SignalsResponse = {
  ticker: string;
  last_price: number;
  daily_bias: {
    label: string;
    predicted_next_pct: number;
    confidence: number;
    last_close: number | null;
    sign: number;
  };
  intraday_structure: { trend: string };
  session_vwap: number | null;
  verdict: { label: string; score: number };
  signal_curve: { time: string; close: number; score: number; score_ema: number; vwap: number }[];
  alerts: {
    time: string;
    direction: string;
    strength: string;
    aligned_with_daily: boolean;
    trigger: string;
    level: number;
    price: number;
    reasons: string[];
  }[];
  support: Level[];
  resistance: Level[];
};

export type PsychologyResponse = {
  ticker: string;
  ipm_now: number;
  zone: string;
  delta_ipm: number;
  sensors_last: Record<string, number>;
  ipm_history: { date: string; ipm: number }[];
};

export type PremarketResponse = {
  ticker: string;
  prev_close: number;
  premarket_available: boolean;
  premarket_last: number | null;
  gap_pct: number | null;
  premarket_bars: { time: string; close: number }[];
  models: Record<
    string,
    {
      ret: number;
      pct: number;
      target_price: number;
      /** 'confirma' | 'contradice' | 'neutral', or null with no premarket session. */
      confirmation: string | null;
      path: { t: string; price: number }[];
    } | null
  >;
};

export type ChartOverlay = {
  support_resistance: { support?: number; resistance?: number; zones?: { type: string; price: number }[] };
  fvg_rectangles: { type: string; top: number; bottom: number; time?: string }[];
  order_blocks: { type: string; high: number; low: number; volume: number; time?: string }[];
  liquidity_markers: { signal: string; level?: number; time?: string };
};

/** GET /patterns — chart overlay plus the intraday context it was built from. */
export type PatternsResponse = ChartOverlay & {
  ticker: string;
  interval_min: number;
  last_price: number;
  structure: { trend: string; last_highs: number[]; last_lows: number[] };
  breakouts: { time: string; type: string; level: number; price: number }[];
  price_action: { time: string; pattern: string; bias: string }[];
};

export type RegimeResponse = {
  ticker: string;
  regime: string;
  confidence: number;
  features: Record<string, number | string>;
};

/** Which curves are available for a ticker, from the /models* endpoints. */
export type TickerCapabilities = {
  xgb: boolean;
  mlp: boolean;
  intraday: boolean;
  extended: boolean;
};
