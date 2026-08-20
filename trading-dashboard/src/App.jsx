import ChartPanel from './components/ChartPanel';
import TradingSimulator from './components/TradingSimulator';
import StrategiesPanel from './components/StrategiesPanel';

const panels=[['Performance','ROI +18.5% | Win Rate 72% | Sharpe 1.8'],['Screener','NVDA BUY | AMD WATCH | TSM BUY'],['Economic Calendar','FED Decision | CPI | Earnings']];

export default function App(){
return <div className="min-h-screen bg-[#121212] text-white flex font-inter">
<aside className="w-72 bg-[#1E1E1E] border-r border-gray-800 p-6">
<h1 className="text-2xl font-bold">Trading Lab</h1>
<nav className="mt-10 space-y-4 text-[#B0B0B0]"><div className="text-[#2962FF]">Dashboard</div><div>Live Trading</div><div>Strategies</div><div>Backtesting</div><div>Portfolio</div><div>AI Agent</div></nav>
</aside>
<main className="flex-1 p-6 space-y-6">
<div className="grid grid-cols-12 gap-6"><div className="col-span-8"><ChartPanel/></div><div className="col-span-4"><TradingSimulator/></div></div>
<StrategiesPanel/>
<div className="grid grid-cols-3 gap-6">{panels.map(p=><div className="card p-5" key={p[0]}><h3 className="font-bold text-lg">{p[0]}</h3><p className="text-gray-400 mt-3">{p[1]}</p></div>)}</div>
</main></div>}
