type Signal = {
  action: string;
  price: number;
  time: string;
};

export default function SignalMarkers({ signals = [] }: { signals?: Signal[] }) {
  return (
    <div className="border rounded-xl p-4 bg-zinc-950">
      <h3 className="font-semibold">AI Trade Markers</h3>
      {signals.length === 0 ? (
        <p className="text-zinc-400 mt-2">No AI signals generated</p>
      ) : (
        signals.map((signal, index) => (
          <div key={index} className="mt-2">
            {signal.action} @ ${signal.price} ({signal.time})
          </div>
        ))
      )}
    </div>
  );
}
