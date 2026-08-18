import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const { ticker = "NVDA" } = await request.json();

  try {
    const response = await fetch(
      `${process.env.TRADING_ENGINE_URL}/market-data?symbol=${ticker}`
    );

    if (!response.ok) {
      throw new Error("Market engine unavailable");
    }

    const data = await response.json();

    return NextResponse.json({
      ticker,
      candles: data.candles || [],
      source: "polygon_market",
    });
  } catch {
    return NextResponse.json({
      ticker,
      candles: [],
      source: "polygon_market",
      status: "waiting-for-engine",
    });
  }
}
