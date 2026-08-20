export type Position = {
  ticker: string;
  shares: number;
  entry: number;
  stop: number;
  target: number;
};

export type Portfolio = {
  balance: number;
  positions: Position[];
  history: { ticker: string; shares: number; entry: number; exit: number; pnl: number }[];
};

let balance = 100000;
let positions: Position[] = [];
let history: Portfolio['history'] = [];

export function openPosition(position: Position) {
  const cost = position.shares * position.entry;
  if (cost > balance) return null;
  balance -= cost;
  positions = [...positions, position];
  return position;
}

export function calculatePnL(position: Position, price: number) {
  return (price - position.entry) * position.shares;
}

export function closePosition(ticker: string, price: number) {
  const position = positions.find((item) => item.ticker === ticker);
  if (!position) return null;

  const pnl = calculatePnL(position, price);
  balance += position.shares * price;
  positions = positions.filter((item) => item !== position);
  history = [...history, { ticker, shares: position.shares, entry: position.entry, exit: price, pnl }];

  return pnl;
}

export function updateBalance(amount: number) {
  balance += amount;
  return balance;
}

export function getPortfolio(): Portfolio {
  return { balance, positions, history };
}

export function resetPortfolio() {
  balance = 100000;
  positions = [];
  history = [];
  return getPortfolio();
}
