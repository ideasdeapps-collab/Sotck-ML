import { NextResponse } from 'next/server';
import { getPortfolio } from '@/lib/trading/paperTradingEngine';

export const dynamic = 'force-dynamic';

export async function GET() {
  return NextResponse.json(getPortfolio());
}
