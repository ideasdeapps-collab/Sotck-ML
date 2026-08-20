"use client";

export default function PaperTradingPanel() {
  return (
    <div className="border rounded p-4 bg-black text-white">
      <h3 className="font-semibold mb-3">Paper Trading</h3>
      <div className="space-y-2 text-sm">
        <p>Virtual Balance: $100,000</p>
        <p>Position: None</p>
        <button className="border rounded px-3 py-2 w-full">BUY</button>
        <button className="border rounded px-3 py-2 w-full">SELL</button>
        <p>Orders: Market / Limit / Stop / OCO</p>
      </div>
    </div>
  );
}
