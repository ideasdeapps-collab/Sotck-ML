import { getCandles } from '@/lib/trading/marketData';
import { BROWSER_USER_AGENT } from '@/lib/trading/liveQuote/sources';
import { GEMINI_SCHEMA, NEWS_SCHEMA, SYSTEM_PROMPT } from './llm';
import { buildReport, createAgentState, type AgentDeps } from './report';
import type { NewsReport } from './types';

/**
 * Agente de noticias del Trading Lab, lado servidor.
 *
 * Junta noticias y datos de mercado del ticker (Polygon, Yahoo, Google News,
 * Nasdaq) y le pide el resumen a Gemini (si hay `GEMINI_API_KEY`) o a OpenAI; la lógica vive en
 * `lib/trading/newsAgent/report.ts` y este módulo aporta red y caché.
 * Lo usan `/api/news-agent` y la predicción con IA, que comparten caché.
 *
 * El panel consulta cada 5 min por pestaña abierta: la caché por ticker hace
 * que varias pestañas compartan un informe, y `force=1` (el botón ↻) solo se la
 * salta si el informe tiene más de 60 s. Las cachés y el tope de GPT viven en
 * memoria, así que en Vercel cada instancia lleva los suyos; basta para que una
 * pestaña abierta no gaste de más.
 */

const REPORT_TTL_MS = 5 * 60_000;
const FORCE_MIN_AGE_MS = 60_000;
const FETCH_TIMEOUT_MS = 5000;
const LLM_TIMEOUT_MS = 20_000;

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';
const GEMINI_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
/**
 * Modelos de Gemini por orden de preferencia: el más barato vigente primero.
 * Google retira modelos para cuentas nuevas sin aviso en el código (pasó con
 * gemini-2.5-flash), así que si uno ya no existe se prueba el siguiente y se
 * recuerda el que respondió.
 */
const GEMINI_FALLBACKS = ['gemini-3.1-flash-lite', 'gemini-3.8-flash'];
let geminiModel: string | null = null;

const geminiCandidates = () =>
  Array.from(new Set([geminiModel, process.env.GEMINI_MODEL, ...GEMINI_FALLBACKS].filter((model): model is string => Boolean(model))));

/** Gemini manda si tiene clave; si no, OpenAI. */
const useGemini = () => Boolean(process.env.GEMINI_API_KEY);
const llmModel = () => (useGemini() ? geminiCandidates()[0] : process.env.OPENAI_MODEL || DEFAULT_MODEL);

/** Error de Gemini que significa «ese modelo no existe o ya no está disponible»: vale la pena probar otro. */
class GeminiModelUnavailable extends Error {}

const reports = new Map<string, NewsReport>();
/** Dos pestañas que piden el mismo ticker a la vez esperan el mismo informe en vez de pagar dos. */
const pending = new Map<string, Promise<NewsReport>>();
const state = createAgentState();

async function get(url: string, accept: string): Promise<Response> {
  const response = await fetch(url, {
    headers: { 'User-Agent': BROWSER_USER_AGENT, Accept: accept },
    cache: 'no-store',
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
  }).catch((error) => {
    throw new Error(error?.name === 'TimeoutError' ? 'sin respuesta' : error?.message || 'error de red');
  });

  // Un 4xx suele traer un JSON con «no existe», que el parser convierte en «sin datos».
  if (response.status >= 500 || response.status === 429 || response.status === 403) {
    throw new Error(`HTTP ${response.status}`);
  }
  return response;
}

async function askGemini(brief: unknown): Promise<unknown> {
  let lastError: Error | null = null;

  for (const model of geminiCandidates()) {
    try {
      const content = await askGeminiModel(model, brief);
      geminiModel = model;
      return content;
    } catch (error: any) {
      if (!(error instanceof GeminiModelUnavailable)) throw error;
      lastError = error;
    }
  }

  throw lastError ?? new Error('Ningún modelo de Gemini disponible');
}

async function askGeminiModel(model: string, brief: unknown): Promise<unknown> {
  const response = await fetch(`${GEMINI_URL}/${encodeURIComponent(model)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY! },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(brief) }] }],
      generationConfig: { temperature: 0.3, responseMimeType: 'application/json', responseSchema: GEMINI_SCHEMA },
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  }).catch((error) => {
    throw new Error(error?.name === 'TimeoutError' ? `Gemini no respondió en ${LLM_TIMEOUT_MS / 1000} s` : error?.message || 'La petición a Gemini falló');
  });

  const raw = await response.text();

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      detail = JSON.parse(raw)?.error?.message || detail;
    } catch {
      /* respuesta no-JSON: se queda el código de estado */
    }
    const message = `Gemini (${model}) rechazó la petición — ${detail}`;
    if (response.status === 404 || /no longer available|not found|is not supported|unknown model/i.test(detail)) {
      throw new GeminiModelUnavailable(message);
    }
    throw new Error(message);
  }

  try {
    const data = JSON.parse(raw);
    const text = data?.candidates?.[0]?.content?.parts?.map((part: { text?: string }) => part.text ?? '').join('');
    if (!text) throw new Error(`Gemini no devolvió texto (${data?.candidates?.[0]?.finishReason || data?.promptFeedback?.blockReason || 'sin motivo'})`);
    return text;
  } catch (error: any) {
    throw new Error(error instanceof SyntaxError ? 'Gemini devolvió una respuesta ilegible' : error.message);
  }
}

async function askOpenAi(brief: unknown): Promise<unknown> {
  const response = await fetch(OPENAI_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
      temperature: 0.3,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: JSON.stringify(brief) },
      ],
      response_format: { type: 'json_schema', json_schema: NEWS_SCHEMA },
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(LLM_TIMEOUT_MS),
  }).catch((error) => {
    throw new Error(error?.name === 'TimeoutError' ? `OpenAI no respondió en ${LLM_TIMEOUT_MS / 1000} s` : error?.message || 'La petición a OpenAI falló');
  });

  const raw = await response.text();

  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      detail = JSON.parse(raw)?.error?.message || detail;
    } catch {
      /* respuesta no-JSON: se queda el código de estado */
    }
    throw new Error(`OpenAI rechazó la petición — ${detail}`);
  }

  try {
    return JSON.parse(raw)?.choices?.[0]?.message?.content;
  } catch {
    throw new Error('OpenAI devolvió una respuesta ilegible');
  }
}

function deps(): AgentDeps {
  return {
    now: () => Date.now(),
    json: async (url) => {
      const response = await get(url, 'application/json');
      return response.json().catch(() => {
        throw new Error('respuesta no JSON');
      });
    },
    text: async (url) => (await get(url, 'application/rss+xml, application/xml, text/xml, */*')).text(),
    dailyCandles: async (ticker) => {
      const { candles, source } = await getCandles(ticker, '1d');
      return { candles, source };
    },
    askLlm: (brief) => (useGemini() ? askGemini(brief) : askOpenAi(brief)),
    polygonKey: process.env.POLYGON_API_KEY || undefined,
    llmAvailable: Boolean(process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY),
    // Getter: el modelo de Gemini que responde puede cambiar durante la petición.
    get model() {
      return llmModel();
    },
  };
}

/** Informe del ticker desde la caché, o uno nuevo; `force` se la salta si tiene más de 60 s. */
export async function getNewsReport(ticker: string, force = false): Promise<{ report: NewsReport; cache: 'hit' | 'miss' }> {
  const cached = reports.get(ticker);
  const age = cached ? Date.now() - cached.generatedAt : Infinity;
  const forced = force && age >= FORCE_MIN_AGE_MS;

  if (cached && age < REPORT_TTL_MS && !forced) return { report: cached, cache: 'hit' };

  let build = pending.get(ticker);
  if (!build) {
    build = buildReport(ticker, deps(), state).finally(() => pending.delete(ticker));
    pending.set(ticker, build);
  }

  const report = await build;
  reports.set(ticker, report);
  return { report, cache: 'miss' };
}
