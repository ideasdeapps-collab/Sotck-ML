"use client";

import { useState } from "react";

export default function LiveTradingTab() {
  const [ticker, setTicker] = useState("NVDA");
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function monitor() {
    setLoading(true);
    const response = await fetch("/ai/live-monitor", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticker }),
    });

    const result = await response.json();
    setData(result);
    setLoading(false);
  }

  return (
    <div style={{ padding: 20 }}>
      <h2>🤖 AI Live Trading Monitor</h2>

      <div>
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          style={{ padding: 8, marginRight: 10 }}
        />
        <button onClick={monitor}>
          {loading ? "Analizando..." : "Actualizar señal"}
        </button>
      </div>

      {data && (
        <div style={{ marginTop: 20 }}>
          <h3>{data.ticker}</h3>
          <p>Precio: {data.price}</p>
          <p>Acción: {data.signal?.action}</p>

          <h4>Portfolio Paper</h4>
          <pre>{JSON.stringify(data.portfolio, null, 2)}</pre>
        </div>
      )}
    </div>
  );
}
