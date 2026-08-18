type Props = {
  action?: string;
  confidence?: number;
  strategy?: string;
  entry?: number;
  stopLoss?: number;
  target?: number;
};

export default function TradeSignal({ action = "BUY", confidence = 0.87, strategy = "Momentum Breakout", entry, stopLoss, target }: Props) {
  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 space-y-2">
      <p className="text-xs text-zinc-400">Signal</p>
      <p className="text-2xl font-bold text-green-400">{action}</p>
      <p>AI Confidence: {Math.round(confidence * 100)}%</p>
      <p>Strategy: {strategy}</p>
      {entry && <p>Entry: ${entry}</p>}
      {stopLoss && <p>Stop Loss: ${stopLoss}</p>}
      {target && <p>Target: ${target}</p>}
    </div>
  );
}
