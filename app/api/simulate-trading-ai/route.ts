import { NextResponse } from "next/server";

export async function POST(request: Request) {
  const body = await request.json();
  const ticker = String(body.ticker || "NVDA").toUpperCase();

  // Pipeline bridge placeholder.
  // The production deployment will execute the Python engine service.
  // Current response exposes the contract consumed by Trading Lab.

  return NextResponse.json({
    ticker,
    status: "pipeline-ready",
    pipeline: {
      marketData: "polygon_market",
      features: "market_features",
      agent: "ai_trading_agent",
      simulation: "simulation_pipeline",
    },
    result: {
      action: "HOLD",
      confidence: 0.5,
      strategy: "Pending optimizer",
      reasons: ["Pipeline connected", "Awaiting execution bridge"],
    },
  });
}
