type Trade = {
  action: string;
  ticker: string;
  price: number;
  pnl?: number;
};

export default function TradeHistory({ trades = [] }: { trades?: Trade[] }) {
  return (
    <div className="border rounded-xl p-4 bg-zinc-950">
      <h3 className="font-semibold">Trade History</h3>
      {trades.length === 0 ? (
        <p className="text-zinc-400 mt-2">No simulated trades</p>
      ) : (
        trades.map((trade, index) => (
          <div key={index} className="mt-2">
            {trade.action} {trade.ticker} @ ${trade.price} {trade.pnl && `(${trade.pnl}%)`}
          </div>
        ))
      )}
    </div>
  );
}
