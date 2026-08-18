import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json();
  const ticker = String(body.ticker || "NVDA").toUpperCase();

  return NextResponse.json({
    ticker,
    status: "ready",
    pipeline: [
      "market-data",
      "technical-features",
      "ai-signal",
      "risk-analysis",
      "simulation",
    ],
    signal: {
      action: "HOLD",
      confidence: 0.5,
      reason: ["AI engine connected", "Awaiting market execution adapter"],
    },
  });
}
