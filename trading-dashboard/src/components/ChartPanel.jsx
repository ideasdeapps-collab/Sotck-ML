import {useEffect,useRef} from 'react';
import {createChart} from 'lightweight-charts';

export default function ChartPanel(){
 const ref=useRef();
 useEffect(()=>{
  const chart=createChart(ref.current,{height:480});
  const candles=chart.addCandlestickSeries();
  candles.setData([{time:'2026-08-18',open:182,high:186,low:180,close:185},{time:'2026-08-19',open:185,high:190,low:184,close:189}]);
  const ema=chart.addLineSeries({color:'#2962FF'});
  ema.setData([{time:'2026-08-18',value:184},{time:'2026-08-19',value:186}]);
  return()=>chart.remove();
 },[]);
 return <div className="bg-white rounded-xl shadow p-4"><h2 className="font-bold mb-3">NVDA Live Chart</h2><div ref={ref}/></div>
}