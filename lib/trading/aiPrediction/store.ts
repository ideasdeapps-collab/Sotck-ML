import type { AiPrediction, PredictionScore } from './types';

/**
 * Tabla `ai_predictions` de Supabase vía PostgREST, solo en el servidor y con
 * la service key (la tabla tiene RLS sin políticas: el navegador no la toca).
 * El SQL está en `supabase/ai_predictions.sql`.
 */

const TIMEOUT_MS = 8000;
/** Todo menos `brief`, que pesa y solo sirve para auditar en Supabase. */
const COLUMNS = 'id,ticker,created_at,as_of,anchor,session_date,model,bias,confidence,reasoning,key_levels,points,score,sources,failures';

export const storeEnabled = () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_KEY);

function headers(extra: Record<string, string> = {}) {
  const key = process.env.SUPABASE_SERVICE_KEY!;
  return { apikey: key, authorization: `Bearer ${key}`, 'content-type': 'application/json', ...extra };
}

const table = () => `${process.env.SUPABASE_URL!.replace(/\/$/, '')}/rest/v1/ai_predictions`;

async function request(url: string, init: RequestInit): Promise<any> {
  const response = await fetch(url, { ...init, cache: 'no-store', signal: AbortSignal.timeout(TIMEOUT_MS) }).catch((error) => {
    throw new Error(error?.name === 'TimeoutError' ? 'Supabase no respondió' : error?.message || 'Supabase falló');
  });

  const raw = await response.text();
  if (!response.ok) {
    let detail = `HTTP ${response.status}`;
    try {
      const body = JSON.parse(raw);
      detail = body?.message || body?.hint || detail;
    } catch {
      /* sin JSON: el código basta */
    }
    // Lo más probable la primera vez: la tabla aún no existe.
    if (/relation .* does not exist|Could not find the table/i.test(detail)) {
      detail += ' — ejecuta supabase/ai_predictions.sql en el SQL Editor de Supabase';
    }
    throw new Error(`Supabase: ${detail}`);
  }
  return raw ? JSON.parse(raw) : null;
}

function fromRow(row: any): AiPrediction {
  return {
    id: row.id,
    ticker: row.ticker,
    createdAt: row.created_at,
    asOf: Date.parse(row.as_of),
    anchor: Number(row.anchor),
    sessionDate: row.session_date,
    model: row.model,
    bias: row.bias,
    confidence: row.confidence,
    reasoning: row.reasoning ?? '',
    keyLevels: row.key_levels ?? [],
    points: row.points ?? [],
    score: row.score ?? null,
    sources: row.sources ?? [],
    failures: row.failures ?? [],
  };
}

export async function insertPrediction(prediction: Omit<AiPrediction, 'id' | 'createdAt'>, brief: unknown): Promise<AiPrediction> {
  const rows = await request(table(), {
    method: 'POST',
    headers: headers({ prefer: 'return=representation' }),
    body: JSON.stringify({
      ticker: prediction.ticker,
      as_of: new Date(prediction.asOf).toISOString(),
      anchor: prediction.anchor,
      session_date: prediction.sessionDate,
      model: prediction.model,
      bias: prediction.bias,
      confidence: prediction.confidence,
      reasoning: prediction.reasoning,
      key_levels: prediction.keyLevels,
      points: prediction.points,
      score: prediction.score,
      sources: prediction.sources,
      failures: prediction.failures,
      brief,
    }),
  });
  return fromRow(rows[0]);
}

/** Las más recientes primero; sin `ticker`, de todos. */
export async function listPredictions(ticker: string | null, limit: number): Promise<AiPrediction[]> {
  const params = new URLSearchParams({ select: COLUMNS, order: 'created_at.desc', limit: String(limit) });
  if (ticker) params.set('ticker', `eq.${ticker}`);
  const rows = await request(`${table()}?${params}`, { method: 'GET', headers: headers() });
  return (rows ?? []).map(fromRow);
}

/** Guarda el resultado definitivo (cuando ya se evaluaron todos los puntos). */
export async function saveScore(id: string, score: PredictionScore): Promise<void> {
  await request(`${table()}?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: headers({ prefer: 'return=minimal' }),
    body: JSON.stringify({ score }),
  });
}
