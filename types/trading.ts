export type TradeSignal = {
  name: string;
  direction: 'LONG' | 'SHORT' | 'WAIT';
  confidence: number;
  reason: string;
  entry?: number;
  stop?: number;
  targets?: number[];
  riskReward?: number;
};

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};
