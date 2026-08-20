import ChartPanel from './components/ChartPanel';

export default function App(){
return <div className="min-h-screen bg-gray-100 flex font-inter">
<aside className="w-64 bg-slate-950 text-white p-6"><h1 className="text-2xl font-bold">Trading Lab</h1><nav className="mt-8 space-y-4"><div>Dashboard</div><div>Strategies</div><div>Portfolio</div><div>AI Agent</div></nav></aside>
<main className="flex-1 p-6 space-y-6"><ChartPanel/><div className="grid grid-cols-3 gap-4"><section className="bg-white rounded-xl p-4">AI Trading Simulator</section><section className="bg-white rounded-xl p-4">Strategies</section><section className="bg-white rounded-xl p-4">Performance</section></div></main>
</div>}
