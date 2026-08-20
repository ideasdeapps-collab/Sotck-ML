const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000';

export async function fetchRealtimeMarket(){
  const response = await fetch(`${API_URL}/ai/realtime-monitor`);
  if(!response.ok){
    throw new Error('Realtime trading API unavailable');
  }
  return response.json();
}
