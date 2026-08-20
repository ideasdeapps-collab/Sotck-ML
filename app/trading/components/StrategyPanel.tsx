"use client";

const strategies = [
  "Momentum Breakout",
  "EMA Pullback",
  "VWAP Reclaim",
  "Mean Reversion",
  "RSI Divergence",
  "MACD Trend",
  "Bollinger Squeeze",
];

export default function StrategyPanel() {
  return (
    <div className="border rounded p-4 bg-black text-white h-full">
      <h3 className="font-semibold mb-3">Trading Techniques</h3>
      <div className="space-y-2 text-sm">
        {strategies.map((strategy) => (
          <button key={strategy} className="block w-full text-left border rounded px-3 py-2 hover:bg-zinc-800">
            {strategy}
          </button>
        ))}
      </div>
    </div>
  );
}
