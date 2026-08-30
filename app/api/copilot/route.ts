import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Veredicto de GPT sobre una operación que las reglas ya construyeron.
 *
 * El modelo NO propone precios. Recibe un setup cerrado — dirección, entrada,
 * stop, objetivos, R:R, tamaño y el contexto técnico — y responde aprobar,
 * rechazar o esperar, con una explicación. Cualquier otra cosa haría que dos
 * ejecuciones del mismo estado del mercado operasen distinto, y el número que
 * el usuario ve en el gráfico dejaría de ser el que se ejecuta.
 *
 * `OPENAI_API_KEY` se lee aquí y solo aquí: sin prefijo `NEXT_PUBLIC_`, igual
 * que `ML_API_URL` en `app/api/ml/[...path]`, así que nunca entra en el bundle.
 * Sin la clave la ruta responde `{ unavailable, reason }` — la misma forma que
 * usa el proxy de ML — y el copiloto sigue funcionando solo con reglas.
 */

const OPENAI_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';
const TIMEOUT_MS = 15000;
const CACHE_TTL_MS = 5 * 60 * 1000;

/**
 * Caché por hash de setup. El gráfico refresca cada 15 s: sin esto, una sola
 * sesión abierta bastaría para hacer miles de llamadas por la misma operación.
 * El cliente ya limita, pero la clave se paga aquí, así que aquí se protege.
 */
const cache = new Map<string, { body: string; expiresAt: number }>();

const SYSTEM_PROMPT = `Eres el copiloto de riesgo de una mesa de day trading que opera en PAPEL (dinero simulado).

Un motor de reglas ya ha construido la operación: dirección, zona de entrada, stop, objetivos, ratio riesgo/beneficio y tamaño. Tú NO propones niveles ni los corriges: los juzgas.

Responde exactamente con:
- "approve" si el setup es coherente y el contexto lo acompaña.
- "wait" si el setup es razonable pero falta confirmación (poco volumen, checklist floja, cerca de un nivel contrario, estructura ambigua).
- "reject" si hay algo que desaconseja la operación (contexto en contra, R:R pobre para el escenario, señal contradictoria).

Sé escéptico y concreto. Cita los números que te han dado. La explicación va en español, en dos o tres frases, sin advertencias genéricas ni disclaimers.`;

const VERDICT_SCHEMA = {
  name: 'copilot_verdict',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['verdict', 'confidence', 'rationale', 'risks'],
    properties: {
      verdict: { type: 'string', enum: ['approve', 'reject', 'wait'] },
      confidence: { type: 'integer', minimum: 0, maximum: 100 },
      rationale: { type: 'string' },
      risks: { type: 'array', items: { type: 'string' } },
    },
  },
} as const;

function unavailable(reason: string, status = 200) {
  return NextResponse.json({ unavailable: true, reason }, { status });
}

/**
 * ¿Hay clave? El panel lo pregunta al montarse para decir si opera con GPT o
 * solo con reglas. Deliberadamente no llama a OpenAI: sondear la disponibilidad
 * no debería costar una petición de pago.
 */
export async function GET() {
  const apiKey = process.env.OPENAI_API_KEY;

  return NextResponse.json({
    available: Boolean(apiKey),
    model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
    reason: apiKey ? '' : 'OPENAI_API_KEY no está configurada — el copiloto opera solo con reglas',
  });
}

export async function POST(request: Request) {
  const apiKey = process.env.OPENAI_API_KEY;

  if (!apiKey) {
    return unavailable('OPENAI_API_KEY no está configurada — el copiloto opera solo con reglas');
  }

  let payload: { hash?: string; setup?: unknown };
  try {
    payload = await request.json();
  } catch {
    return unavailable('Cuerpo de la petición ilegible', 400);
  }

  const { hash, setup } = payload;

  if (typeof hash !== 'string' || !hash || !setup || typeof setup !== 'object') {
    return unavailable('Falta el setup o su hash', 400);
  }

  const hit = cache.get(hash);
  if (hit && hit.expiresAt > Date.now()) {
    return new NextResponse(hit.body, {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-copilot-cache': 'hit' },
    });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const upstream = await fetch(OPENAI_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || DEFAULT_MODEL,
        temperature: 0.2,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(setup) },
        ],
        response_format: { type: 'json_schema', json_schema: VERDICT_SCHEMA },
      }),
      cache: 'no-store',
      signal: controller.signal,
    });

    const raw = await upstream.text();

    if (!upstream.ok) {
      // El detalle de OpenAI es lo único que distingue una clave inválida de
      // una cuota agotada, y el panel lo muestra tal cual.
      let detail = `HTTP ${upstream.status}`;
      try {
        detail = JSON.parse(raw)?.error?.message || detail;
      } catch {
        /* respuesta no-JSON: se queda el código de estado */
      }
      return unavailable(`OpenAI rechazó la petición — ${detail}`, 502);
    }

    const content = JSON.parse(raw)?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') {
      return unavailable('OpenAI devolvió una respuesta sin contenido', 502);
    }

    const verdict = JSON.parse(content);
    const body = JSON.stringify(verdict);

    cache.set(hash, { body, expiresAt: Date.now() + CACHE_TTL_MS });

    return new NextResponse(body, {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-copilot-cache': 'miss' },
    });
  } catch (error: any) {
    const reason =
      error?.name === 'AbortError'
        ? `OpenAI no respondió en ${TIMEOUT_MS / 1000} s`
        : error?.message || 'La petición a OpenAI falló';
    return unavailable(reason, 502);
  } finally {
    clearTimeout(timer);
  }
}
