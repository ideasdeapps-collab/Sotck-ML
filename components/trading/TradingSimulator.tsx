"use client";
import {openPosition,getPortfolio} from '@/lib/trading/paperEngine';

export default function TradingSimulator(){
 const execute=()=>openPosition({ticker:'NVDA',shares:100,entry:178.5,stop:175,target:185});
 return <section><h3>Paper Trading</h3><p>NVDA BUY</p><p>Entry 178.50 · Shares 100</p><button onClick={execute}>EXECUTE</button><pre>{JSON.stringify(getPortfolio(),null,2)}</pre></section>
}
