export type OrderSide = 'BUY' | 'SELL';

export type Position = {
 ticker:string;
 quantity:number;
 entry:number;
 side:OrderSide;
};

let account={
 cash:100000,
 equity:100000,
 positions:[] as Position[],
 trades:[] as any[]
};

export function executePaperTrade(signal:any){
 if(!signal || signal.signal==='HOLD') return account;

 const price=signal.entry;
 const quantity=Math.floor(account.cash/price);

 if(signal.signal==='BUY' && quantity>0){
  account.positions.push({ticker:signal.ticker,quantity,entry:price,side:'BUY'});
  account.cash-=quantity*price;
 }

 account.trades.push({
  ...signal,
  quantity,
  timestamp:new Date().toISOString()
 });

 account.equity=account.cash+account.positions.reduce((s,p)=>s+p.quantity*p.entry,0);
 return account;
}

export function getPortfolio(){
 return account;
}
