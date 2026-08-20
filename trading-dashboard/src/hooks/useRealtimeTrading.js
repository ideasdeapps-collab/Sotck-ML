import {useEffect,useState} from 'react';
import {fetchRealtimeMarket} from '../services/tradingApi';

export default function useRealtimeTrading(){
 const [market,setMarket]=useState(null);
 const [loading,setLoading]=useState(true);

 useEffect(()=>{
  async function load(){
   try{
    const data=await fetchRealtimeMarket();
    setMarket(data);
   }catch(error){
    console.error(error);
   }finally{
    setLoading(false);
   }
  }
  load();
  const timer=setInterval(load,5000);
  return()=>clearInterval(timer);
 },[]);

 return {market,loading};
}
