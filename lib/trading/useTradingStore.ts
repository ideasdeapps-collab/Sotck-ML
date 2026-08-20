"use client";
import {useState} from "react";

let state={ticker:"NVDA",timeframe:"1m",mode:"Live",capital:100000,indicators:{ema20:true,ema50:true,vwap:true,bollinger:true}};
const listeners=new Set<()=>void>();
export function useTradingStore(){
 const [,refresh]=useState(0);
 if(typeof window!=="undefined") listeners.add(()=>refresh(v=>v+1));
 return { ...state,
  setTicker:(ticker:string)=>{state.ticker=ticker;listeners.forEach(f=>f())},
  setMode:(mode:string)=>{state.mode=mode;listeners.forEach(f=>f())},
  setTimeframe:(timeframe:string)=>{state.timeframe=timeframe;listeners.forEach(f=>f())}
 };
}
export const tradingState=state;
