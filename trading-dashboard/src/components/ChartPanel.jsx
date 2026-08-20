import {useEffect,useRef} from 'react';
import {createChart} from 'lightweight-charts';

export default function ChartPanel(){
const ref=useRef();
useEffect(()=>{
const chart=createChart(ref.current,{height:520,layout:{background:{color:'#121212'},textColor:'#B0B0B0'},grid:{vertLines:{color:'#222'},horzLines:{color:'#222'}}});
const candles=chart.addCandlestickSeries({upColor:'#00C853',downColor:'#E53935',borderVisible:false});
candles.setData([{time:'2026-08-18',open:182,high:186,low:180,close:185},{time:'2026-08-19',open:185,high:190,low:184,close:189}]);
const ema=chart.addLineSeries({color:'#FFD600',lineWidth:2});
ema.setData([{time:'2026-08-18',value:184},{time:'2026-08-19',value:186}]);
const vwap=chart.addLineSeries({color:'#9C27B0'});
vwap.setData([{time:'2026-08-18',value:183},{time:'2026-08-19',value:187}]);
return()=>chart.remove();
},[]);
return <div className="card p-5"><h2 className="font-bold text-xl mb-4">NVDA Live Market</h2><div ref={ref}/></div>
}
