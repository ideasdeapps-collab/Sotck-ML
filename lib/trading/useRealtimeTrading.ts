import {useEffect,useState} from 'react';
import {getRealtimeTrading} from './tradingApi';
export function useRealtimeTrading(){const [data,setData]=useState(null);useEffect(()=>{getRealtimeTrading().then(setData).catch(()=>{});},[]);return data;}
