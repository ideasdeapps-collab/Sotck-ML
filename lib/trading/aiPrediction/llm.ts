import { BIASES, type Bias, type PredictionPoint } from './types';

/**
 * DeepSeek recibe todo lo que la app ya calcula y devuelve un precio por cada
 * hora objetivo. Pide solo la lista de precios, sin horas: la respuesta es
 * corta (rápida y barata) y el orden lo fija `horas_objetivo`.
 */

/** Más lejos que esto del ancla no es una predicción de un día, es un error de la IA. */
export const MAX_MOVE = 0.25;

export const SYSTEM_PROMPT = `Eres un analista cuantitativo de day trading que opera en PAPEL (dinero simulado).

Recibes, para un ticker, todo lo que calcula la app: velas de 5 min de hoy, indicadores (EMA, VWAP y bandas, RSI, ATR, Bollinger), niveles del día previo y opening range, el último precio web en tiempo real (las velas de Polygon llegan con ~15 min de retraso; el precio web no), noticias y su sentimiento, el ecosistema de la IA (cómo se mueven sus eslabones), las salidas de los modelos de ML de la app (curva de sesión, curva y señal de 1 min, estructura intradía, patrones, régimen, premarket) y tu historial de predicciones anteriores de este ticker con lo que de verdad pasó.

Tu tarea: proyectar el precio del resto de la sesión regular, un precio por cada hora de «horas_objetivo» (cada 5 minutos hasta las 16:00 ET).

Reglas:
- Devuelve exactamente «n_puntos» precios, en el mismo orden que «horas_objetivo».
- Parte de «ultima_vela.precio». Si hay precio web en tiempo real, los primeros puntos deben pasar cerca de él: ya es real.
- Movimientos realistas: usa el ATR de 5 min como orden de magnitud por paso; no dibujes una recta, el precio oscila, respeta soportes, resistencias y el VWAP, y suele haber reversión hacia el VWAP salvo tendencia clara.
- Aprende del historial: si tus predicciones anteriores tuvieron sesgo (por ejemplo, demasiado alcistas) o fallaron la dirección, corrígelo y dilo en el razonamiento.
- En «historial.resumen.frente_a_ingenuas» ves tu error frente a «plano» (el precio no se mueve) y «momentum» (sigue los últimos 30 min). Si no ganas al plano en un horizonte, tu proyección para ese horizonte debe quedarse cerca del precio actual.
- Usa SOLO los datos recibidos; no inventes noticias ni cifras.

Responde SOLO con un objeto json con esta forma:
{"sesgo": "alcista" | "bajista" | "lateral", "confianza": entero 0-100, "razonamiento": "3 a 5 frases en español que citen los datos que más pesan y qué corriges de tu historial", "niveles_clave": ["hasta 5 niveles o eventos breves"], "precios": [n_puntos números]}`;

export type ParsedPrediction = {
  bias: Bias;
  confidence: number;
  reasoning: string;
  keyLevels: string[];
  points: PredictionPoint[];
};

const BIAS_ALIASES: Record<string, Bias> = { bullish: 'alcista', bearish: 'bajista', neutral: 'lateral', sideways: 'lateral' };

/** Remuestrea linealmente `values` a `length` puntos (la IA a veces cuenta mal la lista). */
export function resample(values: number[], length: number): number[] {
  if (values.length === length) return values;
  if (values.length === 1) return Array(length).fill(values[0]);
  return Array.from({ length }, (_, i) => {
    const position = (i * (values.length - 1)) / Math.max(1, length - 1);
    const low = Math.floor(position);
    const high = Math.min(values.length - 1, low + 1);
    return values[low] + (values[high] - values[low]) * (position - low);
  });
}

/** Valida y normaliza la respuesta; devuelve el motivo si no se puede dibujar. */
export function parsePrediction(content: unknown, targets: number[], anchor: number): ParsedPrediction | string {
  let value: any = content;
  if (typeof content === 'string') {
    try {
      value = JSON.parse(content);
    } catch {
      return 'La IA no devolvió un json válido';
    }
  }

  const rawBias = String(value?.sesgo ?? '').toLowerCase().trim();
  const bias = (BIASES as readonly string[]).includes(rawBias) ? (rawBias as Bias) : BIAS_ALIASES[rawBias];
  if (!bias) return `Sesgo no reconocido: «${value?.sesgo}»`;

  const prices: unknown = value?.precios;
  if (!Array.isArray(prices)) return 'La IA no devolvió la lista de precios';

  const numbers = prices.map(Number);
  if (numbers.some((price) => !Number.isFinite(price) || Math.abs(price / anchor - 1) > MAX_MOVE)) {
    return `La IA devolvió precios imposibles (más de ±${MAX_MOVE * 100} % del ancla)`;
  }

  // Una lista con un 20 % de puntos de más o de menos se remuestrea; más que eso es otra cosa.
  if (numbers.length < targets.length * 0.8 || numbers.length > targets.length * 1.2) {
    return `La IA devolvió ${numbers.length} precios y se pedían ${targets.length}`;
  }

  const fitted = resample(numbers, targets.length);
  const confidence = Math.round(Number(value?.confianza));

  return {
    bias,
    confidence: Number.isFinite(confidence) ? Math.min(100, Math.max(0, confidence)) : 50,
    reasoning: typeof value?.razonamiento === 'string' ? value.razonamiento.trim() : '',
    keyLevels: Array.isArray(value?.niveles_clave)
      ? value.niveles_clave.filter((item: unknown): item is string => typeof item === 'string' && item.trim() !== '').slice(0, 5)
      : [],
    points: targets.map((t, i) => ({ t, p: Number(fitted[i].toFixed(4)) })),
  };
}
