export type Position={ticker:string,shares:number,entry:number,stop:number,target:number};
let balance=100000;let positions:Position[]=[];
export function openPosition(p:Position){positions.push(p);return p}
export function closePosition(ticker:string,price:number){const p=positions.find(x=>x.ticker===ticker);if(!p)return null;return calculatePnL(p,price)}
export function calculatePnL(p:Position,price:number){return (price-p.entry)*p.shares}
export function updateBalance(amount:number){balance+=amount;return balance}
export function getPortfolio(){return {balance,positions}}
