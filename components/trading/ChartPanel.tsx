'use client';

import { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries, createSeriesMarkers } from 'lightweight-charts';
import { useTradingStore } from '@/lib/trading/tradingStore';
import { connectPolygonStream } from '@/lib/trading/polygonStream';
import { generateAISignal, signalToMarker } from '@/lib/trading/aiSignalEngine';

export default function ChartPanel() {
 const chartRef=useRef<HTMLDivElement|null>(null);
 const candlesRef=useRef<any[]>([]);
 const {ticker,timeframe,markers,addCandle,setMarkers,setLive}=useTradingStore();

 useEffect(()=>{
  if(!chartRef.current)return;

  const chart=createChart(chartRef.current,{height:520});
  const candleSeries=chart.addSeries(CandlestickSeries);
  const markerApi=createSeriesMarkers(candleSeries,markers);

  async function load(){
   const response=await fetch(`/api/market/candles?ticker=${ticker}&timeframe=${timeframe}`);
   const data=await response.json();
   const candles=data.candles||data;

   candlesRef.current=candles;
   candleSeries.setData(candles);

   const aiSignal=generateAISignal(candles);

   if(aiSignal.signal==='BUY'){
    const aiMarkers=signalToMarker(candles,'BUY');
    setMarkers(aiMarkers);
    markerApi.setMarkers(aiMarkers);
   }
  }

  load();

  const disconnect=connectPolygonStream(ticker,(candle)=>{
   candleSeries.update(candle);
   candlesRef.current=[...candlesRef.current.slice(-500),candle];
   addCandle(candle);

   const aiSignal=generateAISignal(candlesRef.current);

   if(aiSignal.signal==='BUY'){
    const aiMarkers=signalToMarker(candlesRef.current,'BUY');
    setMarkers(aiMarkers);
    markerApi.setMarkers(aiMarkers);
   }
  });

  markerApi.setMarkers(markers);
  setLive(true);

  chart.timeScale().fitContent();

  return()=>{
   markerApi.detach();
   disconnect();
   setLive(false);
   chart.remove();
  };
 },[ticker,timeframe]);

 return <section className="chart-panel"><h3>{ticker} · {timeframe} LIVE</h3><div ref={chartRef}/></section>;
}
