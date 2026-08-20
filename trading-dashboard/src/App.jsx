import ChartPanel from './components/ChartPanel';
import TradingSimulator from './components/TradingSimulator';
import StrategiesPanel from './components/StrategiesPanel';
import PerformancePanel from './components/PerformancePanel';
import ScreenerPanel from './components/ScreenerPanel';
import IndicatorsPanel from './components/IndicatorsPanel';
import EconomicCalendar from './components/EconomicCalendar';
import AIPortfolioPanel from './components/AIPortfolioPanel';
import useRealtimeTrading from './hooks/useRealtimeTrading';

export default function App(){
 const {market,loading}=useRealtimeTrading();

 if(loading) return <div className="min-h-screen bg-[#121212] text-white p-10">Loading Trading Engine...</div>;

 return <div className="min-h-screen bg-[#121212] text-white flex font-inter">
  <aside className="w-72 bg-[#1E1E1E] p-6 border-r border-gray-800">
   <h1 className="text-2xl font-bold">Trading Lab Pro</h1>
   <nav className="mt-8 space-y-4 text-gray-300">
    <div className="text-blue-500">Dashboard</div>
    <div>Live Trading</div>
    <div>Backtesting</div>
    <div>AI Agent</div>
   </nav>
  </aside>
  <main className="flex-1 p-6 space-y-6">
   <div className="grid grid-cols-12 gap-6">
    <div className="col-span-8"><ChartPanel data={market?.chart}/></div>
    <div className="col-span-4"><TradingSimulator signal={market?.signal}/></div>
   </div>
   <StrategiesPanel data={market?.strategies}/>
   <IndicatorsPanel data={market?.indicators}/>
   <div className="grid grid-cols-3 gap-6">
    <PerformancePanel data={market?.performance}/>
    <ScreenerPanel data={market?.screener}/>
    <EconomicCalendar data={market?.calendar}/>
   </div>
   <AIPortfolioPanel data={market}/>
  </main>
 </div>
}
