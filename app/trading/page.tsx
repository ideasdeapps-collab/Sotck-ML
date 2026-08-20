import TradingSidebar from '@/components/trading/TradingSidebar';
import ChartPanel from '@/components/trading/ChartPanel';
import TradingSimulator from '@/components/trading/TradingSimulator';
import StrategiesPanel from '@/components/trading/StrategiesPanel';
import IndicatorsPanel from '@/components/trading/IndicatorsPanel';
import PerformancePanel from '@/components/trading/PerformancePanel';
import ScreenerPanel from '@/components/trading/ScreenerPanel';
import EconomicCalendar from '@/components/trading/EconomicCalendar';
import AIPortfolioPanel from '@/components/trading/AIPortfolioPanel';
import './trading.css';

export default function TradingPage() {
  return (
    <main className="trading-terminal">
      <TradingSidebar />
      <section className="trading-main">
        <ChartPanel />
        <div className="trading-grid">
          <TradingSimulator />
          <StrategiesPanel />
          <IndicatorsPanel />
          <PerformancePanel />
          <ScreenerPanel />
          <EconomicCalendar />
          <AIPortfolioPanel />
        </div>
      </section>
    </main>
  );
}
