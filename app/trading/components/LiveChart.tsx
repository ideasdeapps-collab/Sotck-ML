type Candle = {
  time: string;
  close: number;
};

export default function LiveChart({ candles = [] }: { candles?: Candle[] }) {
  return (
    <div className="border rounded-xl p-4 bg-zinc-950">
      <h3 className="font-semibold">Intraday 1m Chart</h3>
      <div className="mt-4 h-64 flex items-center justify-center text-zinc-400">
        {candles.length > 0
          ? `${candles.length} candles loaded from Polygon`
          : "Waiting for market candles"}
      </div>
    </div>
  );
}
