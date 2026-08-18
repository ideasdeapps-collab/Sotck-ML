import MarketRegime from "./MarketRegime";
import TradeSignal from "./TradeSignal";

export default function AIRecommendation({ data }: { data?: any }) {
  const result = data?.result || {};

  return (
    <section className="grid gap-4 md:grid-cols-2">
      <MarketRegime trend={data?.features?.trend} />
      <TradeSignal
        action={result.action}
        confidence={result.confidence}
        strategy={result.strategy}
        entry={result.entry}
        stopLoss={result.stopLoss}
        target={result.target}
      />
    </section>
  );
}
