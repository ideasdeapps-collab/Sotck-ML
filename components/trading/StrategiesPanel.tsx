export default function StrategiesPanel(){
 const strategies=[['Momentum Breakout',91],['Mean Reversion',62],['VWAP Reclaim',74]];
 return <section><h2>AI STRATEGIES</h2>{strategies.map(s=><div key={s[0]}><b>{s[0]}</b><p>Confidence {s[1]}%</p><progress value={s[1]} max="100"/></div>)}<button>RUN BACKTEST</button></section>
}
