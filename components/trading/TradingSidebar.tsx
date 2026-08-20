"use client";
import {useTradingStore} from "@/lib/trading/useTradingStore";

export default function TradingSidebar(){
 const {ticker,setTicker,mode,setMode,setSignal,setMarkers,setSession,signal}=useTradingStore();

 async function startAISession(){
  setSession(true);
  const response=await fetch('/api/ai/realtime-monitor',{
   method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({ticker,timeframe:'1m'})
  });
  const data=await response.json();
  setSignal(data);

  if(data.signal){
   setMarkers([{
    time:Date.now()/1000,
    position:data.signal==='BUY'?'belowBar':'aboveBar',
    color:data.signal==='BUY'?'#22c55e':'#ef4444',
    shape:data.signal==='BUY'?'arrowUp':'arrowDown',
    text:data.signal
   }]);
  }
 }

 return <aside className="trading-sidebar">
 <h2>Trading Lab Pro</h2>
 <input value={ticker} onChange={e=>setTicker(e.target.value.toUpperCase())} placeholder="Search ticker" />
 <h3>Watchlist</h3>
 {['NVDA','AMD','TSLA','AAPL','SNDK'].map(x=><button key={x} onClick={()=>setTicker(x)}>{x}</button>)}
 <h3>Market Mode</h3>
 {['Live','Replay','Simulation'].map(x=><label key={x}><input type="radio" checked={mode===x} onChange={()=>setMode(x)}/>{x}</label>)}
 <h3>Capital</h3><p>$100,000</p>
 <button onClick={startAISession}>START AI SESSION</button>
 {signal && <section>
   <h3>{signal.signal}</h3>
   <p>Confidence: {signal.confidence}%</p>
   <p>{signal.strategy}</p>
   </section>}
 </aside>
}
