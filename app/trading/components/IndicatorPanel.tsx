type Props = {
  ema20?: number;
  ema50?: number;
  rsi?: number;
  volumeRatio?: number;
};

export default function IndicatorPanel({ ema20, ema50, rsi, volumeRatio }: Props) {
  return (
    <div className="border rounded-xl p-4 bg-zinc-950 space-y-2">
      <h3 className="font-semibold">Technical Indicators</h3>
      <p>EMA20: {ema20 ?? "-"}</p>
      <p>EMA50: {ema50 ?? "-"}</p>
      <p>RSI: {rsi ?? "-"}</p>
      <p>Volume Ratio: {volumeRatio ?? "-"}</p>
    </div>
  );
}
