export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export async function getCandles(ticker: string, timeframe = "1m") {
  const apiKey = process.env.POLYGON_API_KEY;
  if (!apiKey) throw new Error("Missing POLYGON_API_KEY");

  const multiplier = timeframe === "1m" ? 1 : Number(timeframe.replace(/[^0-9]/g, "")) || 1;
  const timespan = timeframe.includes("h") ? "hour" : "minute";

  const to = new Date();
  const from = new Date(to.getTime() - 24 * 60 * 60 * 1000);

  const url = `https://api.polygon.io/v2/aggs/ticker/${ticker}/range/${multiplier}/${timespan}/${from.toISOString().slice(0,10)}/${to.toISOString().slice(0,10)}?adjusted=true&sort=asc&limit=5000&apiKey=${apiKey}`;

  const response = await fetch(url);
  const data = await response.json();

  const candles: Candle[] = (data.results || []).map((item: any) => ({
    time: Math.floor(item.t / 1000),
    open: item.o,
    high: item.h,
    low: item.l,
    close: item.c,
    volume: item.v
  }));

  return { ticker, timeframe, candles };
}
