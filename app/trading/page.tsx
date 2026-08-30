import TradingSidebar from '@/components/trading/TradingSidebar';
import ChartPanel from '@/components/trading/ChartPanel';
import TradingSimulator from '@/components/trading/TradingSimulator';
import StrategiesPanel from '@/components/trading/StrategiesPanel';
import IndicatorsPanel from '@/components/trading/IndicatorsPanel';
import PerformancePanel from '@/components/trading/PerformancePanel';
import ScreenerPanel from '@/components/trading/ScreenerPanel';
import EconomicCalendar from '@/components/trading/EconomicCalendar';
import CopilotPanel from '@/components/trading/CopilotPanel';
import SignalsPanel from '@/components/trading/SignalsPanel';
import TradePlanPanel from '@/components/trading/TradePlanPanel';
import WickZonesPanel from '@/components/trading/WickZonesPanel';
import SessionJournalPanel from '@/components/trading/SessionJournalPanel';
import RegimePanel from '@/components/trading/RegimePanel';
import './trading.css';

export default function TradingPage() {
  return (
    <main className="trading-terminal">
      <TradingSidebar />
      <section className="trading-main">
        <ChartPanel />
        <div className="trading-grid">
          <CopilotPanel />
          <TradePlanPanel />
          <WickZonesPanel />
          <SignalsPanel />
          <RegimePanel />
          <TradingSimulator />
          <StrategiesPanel />
          <IndicatorsPanel />
          <PerformancePanel />
          <ScreenerPanel />
          <SessionJournalPanel />
          <EconomicCalendar />
        </div>
      </section>
    </main>
  );
}
