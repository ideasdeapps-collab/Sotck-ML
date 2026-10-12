import type { NewsData } from './types';

/** Textos del panel del agente. Puros, para que lo que se lee se pueda probar sin DOM. */

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

const signed = (value: number, digits = 1) => `${value >= 0 ? '+' : ''}${value.toFixed(digits)}`;

function shortDate(date: string): string {
  const [, month, day] = date.split('-').map(Number);
  return `${String(day).padStart(2, '0')}-${MONTHS[month - 1]}`;
}

/** La línea de datos sin IA, un elemento por bloque: es lo verificable del informe. */
export function dataLine(data: NewsData): string[] {
  const { earnings, analysts, insiders, market, momentum, polygon } = data;

  const earningsText = earnings
    ? `Earnings ${shortDate(earnings.date)}${earnings.timing ? ` ${earnings.timing}` : ''} (${earnings.days === 0 ? 'hoy' : `en ${earnings.days} d`})` +
      (earnings.eps !== null ? ` · BPA est. $${earnings.eps.toFixed(2)}` : '')
    : 'Earnings n/d';

  const analystsText = analysts
    ? `Analistas ${analysts.consensus} (${analysts.buy}C/${analysts.hold}M/${analysts.sell}V)` +
      (analysts.target !== null
        ? ` · obj. $${analysts.target.toFixed(2)}${analysts.targetVsPrice !== null ? ` (${signed(analysts.targetVsPrice)}%)` : ''}`
        : '')
    : 'Analistas n/d';

  const insidersText = insiders ? `Insiders 3m: ${insiders.buys3m} compras / ${insiders.sells3m} ventas` : 'Insiders n/d';

  const marketText = market
    ? [
        market.vix !== null ? `VIX ${market.vix.toFixed(1)}${market.vixChange !== null ? ` (${signed(market.vixChange)}%)` : ''}` : 'VIX n/d',
        market.spyChange !== null ? `SPY ${signed(market.spyChange)}%` : 'SPY n/d',
      ].join(' · ')
    : 'VIX n/d';

  const momentumText = momentum
    ? `Momentum 1d ${signed(momentum.change1d)}% · 5d ${signed(momentum.change5d)}% · RSI ${momentum.rsi14.toFixed(0)}`
    : 'Momentum n/d';

  const polygonText = polygon ? `Polygon ${polygon.positive}+ / ${polygon.negative}− / ${polygon.neutral}=` : 'Polygon n/d';

  return [earningsText, analystsText, insidersText, marketText, momentumText, polygonText];
}

export function countdown(ms: number): string {
  const seconds = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

export function etClock(ms: number): string {
  return `${new Date(ms).toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit', timeZone: 'America/New_York' })} ET`;
}
