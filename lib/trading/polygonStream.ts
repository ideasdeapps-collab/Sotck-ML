import type { Candle } from './marketData';

type CandleHandler = (candle: Candle) => void;

/**
 * Live feed for the chart. Polygon's websocket needs both a websocket-enabled
 * plan and a server-side relay (the API key must never reach the browser), so
 * the browser polls the candles route instead and emits only bars that are new
 * or updated. The route's cache collapses duplicate polls across tabs.
 */
export function connectPolygonStream(
  ticker: string,
  onCandle: CandleHandler,
  timeframe = '1m',
  intervalMs = 15000
) {
  if (typeof window === 'undefined') return () => {};

  let stopped = false;
  let lastTime = 0;
  let lastClose = Number.NaN;

  async function poll() {
    try {
      const response = await fetch(
        `/api/market/candles?ticker=${encodeURIComponent(ticker)}&timeframe=${encodeURIComponent(timeframe)}`,
        { cache: 'no-store' }
      );
      if (!response.ok) return;

      const data = await response.json();
      const candles: Candle[] = data?.candles || [];
      const last = candles[candles.length - 1];
      if (!last || stopped) return;

      if (last.time !== lastTime || last.close !== lastClose) {
        lastTime = last.time;
        lastClose = last.close;
        onCandle(last);
      }
    } catch {
      // keep polling; transient network errors must not kill the chart
    }
  }

  const timer = setInterval(poll, intervalMs);
  poll();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}
