'use client';

import { useEffect, useRef } from 'react';
import { createChart, CandlestickSeries, LineSeries, createSeriesMarkers } from 'lightweight-charts';
import { useTradingStore } from '@/lib/trading/tradingStore';
import { connectPolygonStream } from '@/lib/trading/polygonStream';
import { generateAISignal, signalToMarker } from '@/lib/trading/aiSignalEngine';

export default function ChartPanel() {
 const chartRef=useRef<HTMLDivElement|null>(null);
 const {ticker,timeframe,markers,addCandle,setMarkers,setLive}=useTradingStore();

 useEffect(()=>{
  if(!chartRef.current)return;

  const chart=createChart(chartRef.current,{height:520,layout:{background:{color:'#0b0f14'}}});
  const candleSeries=chart.addSeries(CandlestickSeries);

  const markerApi=createSeriesMarkers(candleSeries,markers);

  async function load(){
   const response=await fetch(`/api/market/candles?ticker=${ticker}&timeframe=${timeframe}`);
   const data=await response.json();
   const candles=data.candles||data;

   candleSeries.setData(candles);

   const aiSignal=generateAISignal(candles);

   if(aiSignal.signal==='BUY'){
    setMarkers(signalToMarker(candles,'BUY'));
   }
  }

  load();

  const disconnect=connectPolygonStream(ticker,(candle)=>{
   candleSeries.update(candle);
   addCandle(candle);

   const aiSignal=generateAISignal([...markers,candle] as any);

   if(aiSignal.signal==='BUY'){
    const nextMarkers=signalToMarker([candle] as any,'BUY');
    setMarkers(nextMarkers);
    markerApi.setMarkers(nextMarkers);
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
