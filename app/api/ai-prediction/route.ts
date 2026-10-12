import { NextResponse } from 'next/server';
import { isValidTicker } from '@/lib/trading/liveQuote/sources';
import { generatePrediction, withScores } from '@/lib/trading/aiPrediction/server';
import { listPredictions, storeEnabled } from '@/lib/trading/aiPrediction/store';

export const dynamic = 'force-dynamic';
// Recoger el contexto (~20 s en el peor caso) más la respuesta de DeepSeek.
export const maxDuration = 120;

/**
 * Predicciones de sesión con IA.
 *
 * - GET `?ticker=NVDA` (o `?all=1`): las guardadas, más recientes primero, con
 *   su resultado frente a lo real.
 * - POST `{ ticker }`: genera una nueva con DeepSeek, la guarda y la devuelve.
 *
 * La lógica vive en `lib/trading/aiPrediction`.
 */

const MAX_LIST = 100;

/** Una generación por ticker a la vez: dos clics seguidos no pagan dos llamadas. */
const generating = new Map<string, ReturnType<typeof generatePrediction>>();

export async function GET(request: Request) {
  if (!storeEnabled()) {
    return NextResponse.json({ unavailable: true, reason: 'SUPABASE_URL o SUPABASE_SERVICE_KEY no están configuradas' });
  }

  const params = new URL(request.url).searchParams;
  const all = params.get('all') === '1';
  const ticker = (params.get('ticker') || '').trim().toUpperCase();

  if (!all && !isValidTicker(ticker)) {
    return NextResponse.json({ unavailable: true, reason: 'Ticker no válido' }, { status: 400 });
  }

  const limit = Math.min(MAX_LIST, Math.max(1, Number(params.get('limit')) || 50));

  try {
    const predictions = await withScores(await listPredictions(all ? null : ticker, limit), process.env.POLYGON_API_KEY);
    return NextResponse.json({ predictions });
  } catch (error: any) {
    return NextResponse.json({ unavailable: true, reason: error?.message || 'No se pudieron leer las predicciones' });
  }
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const ticker = String(body?.ticker || '').trim().toUpperCase();

  if (!isValidTicker(ticker)) {
    return NextResponse.json({ unavailable: true, reason: 'Ticker no válido' }, { status: 400 });
  }

  let job = generating.get(ticker);
  if (!job) {
    job = generatePrediction(ticker).finally(() => generating.delete(ticker));
    generating.set(ticker, job);
  }

  try {
    return NextResponse.json({ prediction: await job });
  } catch (error: any) {
    return NextResponse.json({ unavailable: true, reason: error?.message || 'No se pudo generar la predicción' });
  }
}
