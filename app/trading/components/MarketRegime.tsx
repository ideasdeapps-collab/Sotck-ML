export default function MarketRegime({ trend }: { trend?: string }) {
  const value = trend || "Bullish Trend";
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <p className="text-xs text-zinc-400">Market Regime</p>
      <p className="mt-2 text-lg font-semibold text-green-400">🟢 {value}</p>
    </div>
  );
}
