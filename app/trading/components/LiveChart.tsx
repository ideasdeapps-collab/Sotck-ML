"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Bar,
  BarChart,
  ReferenceDot,
} from "recharts";

type Candle = {
  time: string;
  close: number;
  ema20?: number;
  ema50?: number;
  volume?: number;
};

type Signal = {
  action: "BUY" | "SELL";
  time: string;
  price: number;
};

export default function LiveChart({
  candles = [],
  signals = [],
}: {
  candles?: Candle[];
  signals?: Signal[];
}) {
  return (
    <div className="border rounded-xl p-4 bg-zinc-950 space-y-4">
      <h3 className="font-semibold">Intraday 1m Chart</h3>

      {candles.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-zinc-400">
          Waiting for Polygon candles
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={candles}>
              <XAxis dataKey="time" hide />
              <YAxis domain={["auto", "auto"]} />
              <Tooltip />
              <Line dataKey="close" dot={false} />
              <Line dataKey="ema20" dot={false} />
              <Line dataKey="ema50" dot={false} />
              {signals.map((signal, index) => (
                <ReferenceDot
                  key={index}
                  x={signal.time}
                  y={signal.price}
                  label={signal.action}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>

          <ResponsiveContainer width="100%" height={100}>
            <BarChart data={candles}>
              <XAxis dataKey="time" hide />
              <YAxis hide />
              <Bar dataKey="volume" />
            </BarChart>
          </ResponsiveContainer>
        </>
      )}
    </div>
  );
}
