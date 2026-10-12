/**
 * Cadena de valor de la IA, de la energía a los hyperscalers.
 *
 * Solo tickers que cotizan en EE. UU. (Polygon no da Seúl ni Tokio): SK hynix
 * entra por su ADR (SKHY); Samsung y Tokyo Electron se quedan fuera.
 */

export type ChainTicker = { ticker: string; name: string };
export type ChainLink = { id: string; label: string; tickers: ChainTicker[] };

export const AI_CHAIN: ChainLink[] = [
  {
    id: 'energy',
    label: 'Energía',
    tickers: [
      { ticker: 'CEG', name: 'Constellation' },
      { ticker: 'VST', name: 'Vistra' },
      { ticker: 'GEV', name: 'GE Vernova' },
      { ticker: 'OKLO', name: 'Oklo' },
      { ticker: 'SMR', name: 'NuScale' },
      { ticker: 'BE', name: 'Bloom Energy' },
    ],
  },
  {
    id: 'datacenter',
    label: 'Infra datacenter',
    tickers: [
      { ticker: 'VRT', name: 'Vertiv' },
      { ticker: 'ETN', name: 'Eaton' },
      { ticker: 'PWR', name: 'Quanta' },
      { ticker: 'EQIX', name: 'Equinix' },
      { ticker: 'DLR', name: 'Digital Realty' },
    ],
  },
  {
    id: 'equipment',
    label: 'Equipos / litografía',
    tickers: [
      { ticker: 'ASML', name: 'ASML' },
      { ticker: 'AMAT', name: 'Applied Materials' },
      { ticker: 'LRCX', name: 'Lam Research' },
      { ticker: 'KLAC', name: 'KLA' },
    ],
  },
  {
    id: 'foundry',
    label: 'Fundición',
    tickers: [
      { ticker: 'TSM', name: 'TSMC' },
      { ticker: 'INTC', name: 'Intel' },
    ],
  },
  {
    id: 'chips',
    label: 'Chips / GPU',
    tickers: [
      { ticker: 'NVDA', name: 'Nvidia' },
      { ticker: 'AMD', name: 'AMD' },
      { ticker: 'AVGO', name: 'Broadcom' },
      { ticker: 'ARM', name: 'Arm' },
      { ticker: 'MRVL', name: 'Marvell' },
    ],
  },
  {
    id: 'memory',
    label: 'Memoria',
    tickers: [
      { ticker: 'MU', name: 'Micron' },
      { ticker: 'SKHY', name: 'SK hynix' },
      { ticker: 'SNDK', name: 'Sandisk' },
      { ticker: 'WDC', name: 'Western Digital' },
      { ticker: 'STX', name: 'Seagate' },
    ],
  },
  {
    id: 'network',
    label: 'Redes / servidores',
    tickers: [
      { ticker: 'ANET', name: 'Arista' },
      { ticker: 'SMCI', name: 'Supermicro' },
      { ticker: 'DELL', name: 'Dell' },
      { ticker: 'CRDO', name: 'Credo' },
      { ticker: 'ALAB', name: 'Astera Labs' },
      { ticker: 'COHR', name: 'Coherent' },
    ],
  },
  {
    id: 'neocloud',
    label: 'Neoclouds',
    tickers: [
      { ticker: 'CRWV', name: 'CoreWeave' },
      { ticker: 'NBIS', name: 'Nebius' },
    ],
  },
  {
    id: 'hyperscalers',
    label: 'Hyperscalers',
    tickers: [
      { ticker: 'MSFT', name: 'Microsoft' },
      { ticker: 'AMZN', name: 'Amazon' },
      { ticker: 'GOOGL', name: 'Alphabet' },
      { ticker: 'META', name: 'Meta' },
      { ticker: 'ORCL', name: 'Oracle' },
    ],
  },
];

export const AI_TICKERS = AI_CHAIN.flatMap((link) => link.tickers.map((entry) => entry.ticker));
