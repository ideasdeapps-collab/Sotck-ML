import { EMOTIONS, type Emotion, type Headline, type LlmReport, type NewsData } from './types';

/**
 * GPT solo redacta: recibe los números ya calculados y los titulares, y
 * devuelve sentimiento, emoción, resumen y riesgos. Cualquier cifra que cite
 * tiene que estar en lo que se le manda, y el panel enseña esas mismas cifras
 * aparte para que se puedan comprobar.
 */

/** Un resumen más viejo que esto se renueva aunque no haya titulares nuevos: citaría un VIX que ya no es. */
export const LLM_MAX_AGE_MS = 60 * 60_000;

export const SYSTEM_PROMPT = `Eres el analista de noticias de una mesa de day trading que opera en PAPEL (dinero simulado).

Recibes, para un ticker: datos de mercado ya calculados (precio, consenso de analistas y precio objetivo, fecha de earnings, compras y ventas de directivos, VIX y SPY, momentum, y el sentimiento que Polygon asigna a sus noticias) y los titulares de las últimas 24 h, más titulares de geopolítica y macro.

Devuelve:
- score: sentimiento neto hacia el ticker, entero de -100 (muy bajista) a 100 (muy alcista).
- emotion: la emoción que domina el mercado sobre este ticker: miedo, cautela, neutral, optimismo o euforia.
- summary: 3 o 4 frases en español que expliquen qué está moviendo al ticker y con qué ánimo. Cita los números que te han dado.
- risks: de 2 a 4 riesgos o catalizadores concretos y breves (por ejemplo «Earnings en 5 días», «Ventas de directivos»).

Usa SOLO los datos y titulares recibidos; no inventes cifras, fechas ni noticias. Menciona la geopolítica o la macro solo si afecta a este ticker o al mercado en general. Un dato ausente (null) no es una noticia: no lo menciones. Sin advertencias genéricas ni disclaimers.`;

export const NEWS_SCHEMA = {
  name: 'news_report',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['score', 'emotion', 'summary', 'risks'],
    properties: {
      score: { type: 'integer' },
      emotion: { type: 'string', enum: [...EMOTIONS] },
      summary: { type: 'string' },
      risks: { type: 'array', items: { type: 'string' } },
    },
  },
} as const;

/**
 * El mismo esquema en el dialecto de Gemini (`responseSchema`, subconjunto de
 * OpenAPI): sin `additionalProperties` ni `strict`, que Gemini rechaza.
 */
export const GEMINI_SCHEMA = {
  type: 'OBJECT',
  required: ['score', 'emotion', 'summary', 'risks'],
  propertyOrdering: ['score', 'emotion', 'summary', 'risks'],
  properties: {
    score: { type: 'INTEGER' },
    emotion: { type: 'STRING', enum: [...EMOTIONS] },
    summary: { type: 'STRING' },
    risks: { type: 'ARRAY', items: { type: 'STRING' } },
  },
} as const;

const etTime = (ms: number) =>
  `${new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' })} ET`;

/** Sin URLs ni cuerpos de artículo: no aportan al resumen y multiplican los tokens. */
function compact(headline: Headline) {
  return {
    hora: etTime(headline.publishedAt),
    fuente: headline.source,
    titulo: headline.title,
    ...(headline.sentiment ? { sentimiento_polygon: headline.sentiment } : {}),
    ...(headline.reasoning ? { razon_polygon: headline.reasoning } : {}),
  };
}

export function buildBrief(input: { ticker: string; data: NewsData; headlines: Headline[]; macro: Headline[]; now: number }) {
  return {
    ticker: input.ticker,
    hora: etTime(input.now),
    datos: input.data,
    titulares: input.headlines.map(compact),
    geopolitica_macro: input.macro.map(compact),
  };
}

export function shouldAskLlm(previous: { ids: string[]; at: number } | null, ids: string[], now: number): boolean {
  if (!previous) return true;
  if (now - previous.at > LLM_MAX_AGE_MS) return true;

  const seen = new Set(previous.ids);
  return ids.some((id) => !seen.has(id));
}

/** El esquema estricto ya lo exige, pero lo que se pinta se valida aquí: un score de 150 no llega al panel. */
export function parseLlmReport(content: unknown): LlmReport | null {
  let value: any = content;

  if (typeof content === 'string') {
    try {
      value = JSON.parse(content);
    } catch {
      return null;
    }
  }

  const { score, emotion, summary, risks } = value ?? {};

  if (!Number.isInteger(score) || score < -100 || score > 100) return null;
  if (!EMOTIONS.includes(emotion)) return null;
  if (typeof summary !== 'string' || !summary.trim()) return null;
  if (!Array.isArray(risks)) return null;

  return {
    score,
    emotion: emotion as Emotion,
    summary: summary.trim(),
    risks: risks.filter((risk): risk is string => typeof risk === 'string' && risk.trim() !== '').slice(0, 4),
  };
}
