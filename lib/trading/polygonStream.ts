type CandleHandler = (candle:any)=>void;

let socket: WebSocket | null = null;

export function connectPolygonStream(ticker:string, onCandle:CandleHandler){
 if(typeof window === 'undefined') return () => {};

 const wsUrl = `/api/market/stream?ticker=${ticker}`;
 socket = new WebSocket(wsUrl);

 socket.onmessage = (event)=>{
  const data = JSON.parse(event.data);
  if(data.candle) onCandle(data.candle);
 };

 return ()=>{
  socket?.close();
  socket=null;
 };
}
