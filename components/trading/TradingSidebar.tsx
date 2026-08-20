"use client";
import {useTradingStore} from "@/lib/trading/useTradingStore";

export default function TradingSidebar(){
 const {ticker,setTicker,mode,setMode}=useTradingStore();
 return <aside className="trading-sidebar">
 <h2>Trading Lab Pro</h2>
 <input value={ticker} onChange={e=>setTicker(e.target.value.toUpperCase())} placeholder="Search ticker" />
 <h3>Watchlist</h3>
 {['NVDA','AMD','TSLA','AAPL','SNDK'].map(x=><button key={x} onClick={()=>setTicker(x)}>{x}</button>)}
 <h3>Market Mode</h3>
 {['Live','Replay','Simulation'].map(x=><label key={x}><input type="radio" checked={mode===x} onChange={()=>setMode(x)}/>{x}</label>)}
 <h3>Capital</h3><p>$100,000</p>
 <button>START AI SESSION</button>
 </aside>
}
