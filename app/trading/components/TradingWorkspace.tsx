export default function TradingWorkspace() {
  return (
    <main className="grid grid-cols-1 lg:grid-cols-4 gap-4 p-4">
      <section className="border rounded p-4">Watchlist</section>
      <section className="lg:col-span-2 border rounded p-4">Chart / Indicators</section>
      <section className="border rounded p-4">Strategy Suggestions / Position</section>
      <section className="lg:col-span-4 border rounded p-4">Trade Log</section>
    </main>
  );
}
