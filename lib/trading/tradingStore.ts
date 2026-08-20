"use client";
import {useState} from "react";

let state={
 ticker:"NVDA",
 timeframe:"1m",
 markers:[] as any[],
 candles:[] as any[],
 signal:null as any,
 live:false
};
const listeners=new Set<()=>void>();

export function useTradingStore(){
 const [,refresh]=useState(0);
 if(typeof window!=="undefined") listeners.add(()=>refresh(v=>v+1));
 return {
  ...state,
  setMarkers:(markers:any[])=>{state.markers=markers;listeners.forEach(f=>f())},
  setSignal:(signal:any)=>{state.signal=signal;listeners.forEach(f=>f())},
  addCandle:(candle:any)=>{state.candles=[...state.candles.slice(-500),candle];listeners.forEach(f=>f())},
  setLive:(live:boolean)=>{state.live=live;listeners.forEach(f=>f())}
 };
}

export const tradingState=state;
