'use client';

import { useEffect, useRef } from 'react';

export default function MarketChart() {
  const chartRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // lightweight-charts integration point
    // candles, volume and indicators will be connected here
  }, []);

  return (
    <div ref={chartRef} className="h-[500px] w-full border rounded">
      Chart Engine
    </div>
  );
}
