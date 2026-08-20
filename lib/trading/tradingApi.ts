export async function getRealtimeTrading(){const r=await fetch('/api/ai/realtime-monitor');return r.json();}
