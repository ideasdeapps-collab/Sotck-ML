import type { Metadata } from "next";
import "./trading.css";

export const metadata: Metadata = {
  title: "Trading Lab | Stock ML",
  description: "AI trading workspace with strategies, charts and simulations.",
};

export default function TradingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <section className="trading-root">{children}</section>;
}
