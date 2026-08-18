import PerformanceCard from "./PerformanceCard";

export default function MetricsPanel({ metrics }: { metrics?: any }) {
  return (
    <PerformanceCard
      totalReturn={metrics?.totalReturn}
      winRate={metrics?.winRate}
      maxDrawdown={metrics?.maxDrawdown}
      profitFactor={metrics?.profitFactor}
      trades={metrics?.trades}
      sharpeRatio={metrics?.sharpeRatio}
    />
  );
}
