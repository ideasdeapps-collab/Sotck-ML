import { NextResponse } from 'next/server';
import { minuteBars } from '@/lib/trading/polygonMinutes';
import { dayRaceFrames, parseTickerList, raceFrames } from '@/lib/trading/race/race';
import type { Bar } from '@/lib/trading/aiEcosystem/moves';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/**
 * Carrera del día (`mode=day`, por defecto) o de 5 minutos (`mode=5m`) de una lista de tickers (la columna elegida del
 * ecosistema o una lista propia). Las barras vienen de la caché compartida con
 * el diagrama del ecosistema, así que la columna por defecto no cuesta llamadas
 * extra. Solo se envían las fotos de la carrera (una por minuto), no las barras.
 */

export async function GET(request: Request) {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ unavailable: true, reason: 'POLYGON_API_KEY no está configurada' });
  }

  const params = new URL(request.url).searchParams;
  const tickers = parseTickerList(params.get('tickers') || '');
  const mode = params.get('mode') === '5m' ? '5m' : 'day';
  if (tickers.length === 0) {
    return NextResponse.json({ unavailable: true, reason: 'Ningún ticker válido' }, { status: 400 });
  }

  const now = Date.now();
  const results = await Promise.all(tickers.map((ticker) => minuteBars(ticker, apiKey, now)));

  const barsByTicker: Record<string, Bar[]> = {};
  const failures: string[] = [];

  tickers.forEach((ticker, i) => {
    const result = results[i];
    if (typeof result === 'string') failures.push(result);
    barsByTicker[ticker] = typeof result === 'string' ? [] : result;
  });

  const race = mode === '5m' ? raceFrames(barsByTicker) : dayRaceFrames(barsByTicker);
  return NextResponse.json({ generatedAt: now, mode, tickers, ...race, failures });
}
