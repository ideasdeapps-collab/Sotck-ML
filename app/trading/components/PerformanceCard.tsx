type Props = {
  totalReturn?: number;
  winRate?: number;
  maxDrawdown?: number;
  profitFactor?: number;
  trades?: number;
  sharpeRatio?: number;
};

export default function PerformanceCard({
  totalReturn = 0,
  winRate = 0,
  maxDrawdown = 0,
  profitFactor = 0,
  trades = 0,
  sharpeRatio = 0,
}: Props) {
  return (
    <div className="border rounded-xl p-4 bg-zinc-950 grid gap-2">
      <h3 className="font-semibold">Performance Metrics</h3>
      <p>Total Return: {totalReturn}%</p>
      <p>Win Rate: {winRate}%</p>
      <p>Max Drawdown: {maxDrawdown}%</p>
      <p>Profit Factor: {profitFactor}</p>
      <p>Trades: {trades}</p>
      <p>Sharpe Ratio: {sharpeRatio}</p>
    </div>
  );
}
