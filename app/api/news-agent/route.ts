import { NextResponse } from 'next/server';
import { getCandles } from '@/lib/trading/marketData';
import { BROWSER_USER_AGENT, isValidTicker } from '@/lib/trading/liveQuote/sources';
import { GEMINI_SCHEMA, NEWS_SCHEMA, SYSTEM_PROMPT } from '@/lib/trading/newsAgent/llm';
import { buildReport, createAgentState, type AgentDeps } from '@/lib/trading/newsAgent/report';
import type { NewsReport } from '@/lib/trading/newsAgent/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Agente de noticias del Trading Lab.
 *
 * Junta noticias y datos de mercado del ticker (Polygon, Yahoo, Google News,
 * Nasdaq) y le pide el resumen a Gemini (si hay `GEMINI_API_KEY`) o a OpenAI; la lógica vive en
 * `lib/trading/newsAgent/report.ts` y esta ruta solo aporta red y caché.
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
const DEFAULT_GEMINI_MODEL = 'gemini-2.5-flash';

/** Gemini manda si tiene clave; si no, OpenAI. */
const useGemini = () => Boolean(process.env.GEMINI_API_KEY);
const llmModel = () =>
  useGemini() ? process.env.GEMINI_MODEL || DEFAULT_GEMINI_MODEL : process.env.OPENAI_MODEL || DEFAULT_MODEL;

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
  const response = await fetch(`${GEMINI_URL}/${encodeURIComponent(llmModel())}:generateContent`, {
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
    throw new Error(`Gemini rechazó la petición — ${detail}`);
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
    model: llmModel(),
  };
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const ticker = (params.get('ticker') || '').trim().toUpperCase();

  if (!isValidTicker(ticker)) {
    return NextResponse.json({ unavailable: true, reason: 'Ticker no válido' }, { status: 400 });
  }

  const cached = reports.get(ticker);
  const age = cached ? Date.now() - cached.generatedAt : Infinity;
  const forced = params.get('force') === '1' && age >= FORCE_MIN_AGE_MS;

  if (cached && age < REPORT_TTL_MS && !forced) {
    return NextResponse.json(cached, { headers: { 'x-news-agent-cache': 'hit' } });
  }

  let build = pending.get(ticker);
  if (!build) {
    build = buildReport(ticker, deps(), state).finally(() => pending.delete(ticker));
    pending.set(ticker, build);
  }

  const report = await build;
  reports.set(ticker, report);

  return NextResponse.json(report, { headers: { 'x-news-agent-cache': 'miss' } });
}
