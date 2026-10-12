/**
 * Predicción del resto de la sesión hecha por IA (DeepSeek).
 *
 * Tiempos en epoch ms, como el resto de los datos de servidor; el gráfico los
 * pasa a segundos al dibujarlos.
 */

export const BIASES = ['alcista', 'bajista', 'lateral'] as const;
export type Bias = (typeof BIASES)[number];

/** Un punto de la proyección: precio previsto a la hora `t`. */
export type PredictionPoint = { t: number; p: number };

/**
 * Resultado a un horizonte fijo, comparado con dos predicciones ingenuas:
 * - plano: «el precio se queda donde estaba» (el ancla);
 * - momentum: «sigue lo que hizo los 30 min anteriores», extrapolado hasta
 *   60 min como mucho (más allá se queda plano: una tendencia de 30 min no se
 *   proyecta toda la tarde).
 * Si la IA no gana al plano, no aporta.
 */
export type HorizonResult = {
  label: '30 min' | '60 min' | 'cierre';
  t: number;
  predictedPct: number;
  actualPct: number;
  /** Errores absolutos en % del precio real. */
  errorPct: number;
  flatErrorPct: number;
  momentumErrorPct: number | null;
  directionHit: boolean;
  momentumHit: boolean | null;
};

/** Qué tal salió una predicción frente a las barras reales de 1 min. */
export type PredictionScore = {
  /** Puntos cuya hora ya pasó y se pudieron comparar. */
  evaluated: number;
  total: number;
  /** Error absoluto medio, en % del precio real. */
  maePct: number | null;
  /** Error con signo del último punto evaluado: positivo = la IA esperaba más arriba. */
  endErrorPct: number | null;
  /** Si acertó la dirección desde el ancla hasta el último punto evaluado. */
  directionHit: boolean | null;
  /** Error medio que habría tenido la predicción plana (todo el camino en el ancla). Ausente en resultados antiguos. */
  flatMaePct?: number | null;
  /** Horizontes fijos ya alcanzados. Ausente en resultados antiguos. */
  horizons?: HorizonResult[];
  /** Todos los puntos evaluados: el resultado ya no cambia y se guarda. */
  complete: boolean;
  /** Puntos de control (≈ uno por hora) para el contexto de aprendizaje. */
  checkpoints: { t: number; predicted: number; actual: number }[];
};

export type AiPrediction = {
  id: string;
  ticker: string;
  /** ISO, de Supabase. */
  createdAt: string;
  /** Cierre de la última barra de Polygon usada (epoch ms). */
  asOf: number;
  /** Precio de esa barra: donde arranca la proyección. */
  anchor: number;
  /** Fecha ET de la sesión, YYYY-MM-DD. */
  sessionDate: string;
  model: string;
  bias: Bias;
  confidence: number;
  reasoning: string;
  keyLevels: string[];
  points: PredictionPoint[];
  score: PredictionScore | null;
  /** Bloques de contexto que sí llegaron a la IA. */
  sources: string[];
  /** Bloques que fallaron (no llegaron a la IA). */
  failures: string[];
};
