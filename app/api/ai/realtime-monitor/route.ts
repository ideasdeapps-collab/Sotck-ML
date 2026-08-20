import {NextResponse} from 'next/server';
export async function POST(req:Request){
 const {ticker,timeframe}=await req.json();
 return NextResponse.json({ticker,timeframe,signal:'BUY',confidence:91,strategy:'Momentum Breakout',entry:178.4,stop:175,target:186});
}
