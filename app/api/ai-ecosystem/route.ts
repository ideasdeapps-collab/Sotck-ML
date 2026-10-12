import { NextResponse } from 'next/server';
import { getEcosystem } from '@/lib/trading/aiEcosystem/server';

export const dynamic = 'force-dynamic';
export const maxDuration = 30;

/** Movimiento de la cadena de la IA; la red y la caché viven en `lib/trading/aiEcosystem/server.ts`. */
export async function GET() {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ unavailable: true, reason: 'POLYGON_API_KEY no está configurada' });
  }

  const { report, cache } = await getEcosystem(apiKey);
  return NextResponse.json(report, { headers: { 'x-ai-ecosystem-cache': cache } });
}
