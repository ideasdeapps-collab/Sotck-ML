import { executePaperTrade } from './paperTradingEngine';

let running=false;
let timer:any;

export function startAITradingLoop(config:any){
 if(running) return;
 running=true;

 timer=setInterval(async()=>{
  const response=await fetch('/api/ai/realtime-monitor',{
   method:'POST',
   headers:{'Content-Type':'application/json'},
   body:JSON.stringify({
    ticker:config.ticker,
    timeframe:config.timeframe || '1m'
   })
  });

  const signal=await response.json();

  if(signal.confidence>=80){
   executePaperTrade(signal);
  }
 },60000);
}

export function stopAITradingLoop(){
 running=false;
 clearInterval(timer);
}
