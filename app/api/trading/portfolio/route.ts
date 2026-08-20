import { NextResponse } from 'next/server';
import { getPortfolio } from '@/lib/trading/paperTradingEngine';

export async function GET(){
 return NextResponse.json(getPortfolio());
}
