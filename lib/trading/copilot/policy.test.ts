import { describe, expect, it } from 'vitest';
import { chooseCandidate, decide, resolvePosition, setupHash, type PolicyInput } from './policy';
import type { CopilotSetups } from './setups';
import type { IntradayPlan } from '../dayTrading/intradayPlan';
import type { WickSetup, WickZone } from '../priceAction/wickZones';
import type { Position } from '../paperEngine';

/**
 * `decide` recibe los setups ya construidos, así que los tests los fabrican a
 * mano en vez de generar velas: lo que se comprueba aquí es la política, no la
 * detección de estructura — eso ya lo hacen `intradayPlan` y `wickZones`.
 */

const plan = (overrides: Partial<IntradayPlan> = {}): IntradayPlan =>
  ({
    direction: 'long',
    bias: 'auto',
    lastPrice: 100,
    entry: [99.5, 100.5],
    entryMid: 100,
    entryType: 'retroceso a soporte',
    stopLoss: 98,
    takeProfit: [104, 108],
    riskReward: 2,
    supportZone: null,
    resistanceZone: null,
    levels: { s1: null, s2: null, r1: null, r2: null },
    scenarios: { bullish: null, bearish: null },
    checklist: [{ label: 'VWAP', ok: true, detail: 'por encima' }],
    rationale: 'Soporte con 4 toques',
    ...overrides,
  }) as IntradayPlan;

const zone = (status: WickZone['status']): WickZone =>
  ({
    id: 'z1',
    side: 'demand',
    direction: 'long',
    time: 0,
    index: 0,
    top: 100.5,
    bottom: 99.5,
    wickRatio: 0.7,
    impulse: 1.4,
    status,
    retestTime: null,
    target: 106,
    age: 3,
  }) as WickZone;

const wick = (status: WickZone['status'] = 'active'): WickSetup =>
  ({
    zone: zone(status),
    direction: 'long',
    lastPrice: 100,
    entry: [99.5, 100.5],
    entryMid: 100,
    entryType: 'retesteo de zona de demanda',
    stopLoss: 99,
    takeProfit: [103, 106],
    riskReward: 3,
    checklist: [],
    rationale: 'Mecha con impulso de 1.4 ATR',
  }) as WickSetup;

const setups = (overrides: Partial<CopilotSetups> = {}): CopilotSetups => ({
  plan: null,
  wick: null,
  elliott: null,
  ...overrides,
});

function input(overrides: Partial<PolicyInput> = {}): PolicyInput {
  return {
    ticker: 'NVDA',
    timeframe: '5m',
    setups: setups({ plan: plan() }),
    position: null,
    price: 100,
    previousPrice: 100.2,
    capital: 100000,
    riskPerTrade: 0.01,
    balance: 100000,
    ...overrides,
  };
}

const position = (overrides: Partial<Position> = {}): Position => ({
  id: 'p1',
  ticker: 'NVDA',
  shares: 50,
  entry: 100,
  stop: 98,
  target: 104,
  target2: 108,
  side: 'long',
  owner: 'copilot',
  openedAt: 0,
  ...overrides,
});

describe('chooseCandidate', () => {
  it('lets an active wick zone win over the intraday plan', () => {
    const chosen = chooseCandidate(setups({ plan: plan(), wick: wick('active') }));
    expect(chosen?.source).toBe('wick');
  });

  it('falls back to the plan when the zone is not being tested', () => {
    const chosen = chooseCandidate(setups({ plan: plan(), wick: wick('armed') }));
    expect(chosen?.source).toBe('plan');
  });

  it('uses a non-active wick setup when there is no plan', () => {
    expect(chooseCandidate(setups({ wick: wick('armed') }))?.source).toBe('wick');
  });

  it('has nothing to offer without setups', () => {
    expect(chooseCandidate(setups())).toBeNull();
  });
});

describe('decide — closing comes first', () => {
  it('closes at the stop before looking at any new setup', () => {
    const decision = decide(input({ position: position(), price: 97.5, previousPrice: 99 }));

    expect(decision.kind).toBe('close');
    if (decision.kind === 'close') {
      expect(decision.close.outcome).toBe('stop');
      expect(decision.close.price).toBe(98);
    }
  });

  it('takes the better fill when one move clears both targets', () => {
    const decision = decide(input({ position: position(), price: 109, previousPrice: 101 }));

    expect(decision.kind).toBe('close');
    if (decision.kind === 'close') {
      expect(decision.close.outcome).toBe('tp2');
      expect(decision.close.price).toBe(108);
    }
  });

  it('holds an open position that has not resolved', () => {
    const decision = decide(input({ position: position(), price: 101, previousPrice: 100.5 }));
    expect(decision.kind).toBe('idle');
  });

  it('never opens a second position while one is live', () => {
    const decision = decide(input({ position: position(), price: 100, previousPrice: 100.1 }));
    expect(decision.kind).not.toBe('open');
  });
});

describe('decide — opening', () => {
  it('opens when the price sits inside the entry band', () => {
    const decision = decide(input());

    expect(decision.kind).toBe('open');
    if (decision.kind === 'open') {
      expect(decision.proposal.direction).toBe('long');
      // riesgo 1% de 100 000 = 1 000; riesgo por acción = 2 → 500 acciones.
      expect(decision.proposal.shares).toBe(500);
      expect(decision.proposal.riskReward).toBe(2);
    }
  });

  it('caps the size at what the cash can actually buy', () => {
    // El riesgo permitiría 500 acciones a 100 $; con 20 000 $ solo caben 200.
    const decision = decide(input({ balance: 20000 }));

    if (decision.kind !== 'open') throw new Error('expected an open decision');
    expect(decision.proposal.shares).toBe(200);
    // El riesgo baja con el tamaño: 200 acciones x 2 $ de stop.
    expect(decision.proposal.riskAmount).toBe(400);
    expect(decision.proposal.reasons.some((reason) => reason.startsWith('Tamaño recortado'))).toBe(true);
  });

  it('stands aside when the cash cannot buy a single share', () => {
    const decision = decide(input({ balance: 50 }));

    expect(decision.kind).toBe('idle');
    if (decision.kind === 'idle') expect(decision.reasons[0]).toMatch(/Efectivo insuficiente/);
  });

  it('does not chase a price above the band', () => {
    const decision = decide(input({ price: 101 }));

    expect(decision.kind).toBe('idle');
    if (decision.kind === 'idle') expect(decision.reasons[0]).toMatch(/fuera de la zona de entrada/);
  });

  it('does not chase a price below the band', () => {
    expect(decide(input({ price: 99 })).kind).toBe('idle');
  });

  it('drops a setup that risk management refuses', () => {
    // Objetivo a 101 sobre una entrada en 100 con stop en 98 → R:R 0.5.
    const decision = decide(input({ setups: setups({ plan: plan({ takeProfit: [101, 102] }) }) }));

    expect(decision.kind).toBe('idle');
    if (decision.kind === 'idle') expect(decision.reasons[0]).toMatch(/below the 1\.5 minimum/);
  });

  it('reports there is no structure when nothing is on offer', () => {
    const decision = decide(input({ setups: setups() }));

    expect(decision.kind).toBe('idle');
    if (decision.kind === 'idle') expect(decision.reasons[0]).toMatch(/Sin setup operativo/);
  });

  it('carries the checklist and the rationale into the reasons', () => {
    const decision = decide(input());

    if (decision.kind !== 'open') throw new Error('expected an open decision');
    expect(decision.proposal.reasons).toContain('Soporte con 4 toques');
    expect(decision.proposal.reasons.some((reason) => reason.startsWith('✓ VWAP'))).toBe(true);
  });

  it('records Elliott as context, for or against', () => {
    const against = decide(
      input({
        setups: setups({
          plan: plan(),
          elliott: { direction: 'short', probability: 72, state: 'forming' } as any,
        }),
      })
    );

    if (against.kind !== 'open') throw new Error('expected an open decision');
    expect(against.proposal.reasons.at(-1)).toMatch(/en contra del setup/);
  });

  it('opens shorts with the levels the setup declared', () => {
    const short = plan({ direction: 'short', stopLoss: 102, takeProfit: [96, 92] });
    const decision = decide(input({ setups: setups({ plan: short }) }));

    if (decision.kind !== 'open') throw new Error('expected an open decision');
    expect(decision.proposal.direction).toBe('short');
    expect(decision.proposal.stopLoss).toBe(102);
  });
});

describe('resolvePosition', () => {
  it('resolves a short at its stop above the entry', () => {
    const short = position({ side: 'short', stop: 102, target: 96, target2: 92 });
    const close = resolvePosition(short, 101, 103);

    expect(close?.outcome).toBe('stop');
    expect(close?.price).toBe(102);
  });

  it('resolves a short at its target below the entry', () => {
    const short = position({ side: 'short', stop: 102, target: 96, target2: 92 });
    expect(resolvePosition(short, 98, 95)?.outcome).toBe('tp1');
  });

  it('is inert when the price did not move', () => {
    expect(resolvePosition(position(), 100, 100)).toBeNull();
  });

  it('handles a position with no second target', () => {
    const single = position({ target2: undefined });
    expect(resolvePosition(single, 101, 105)?.outcome).toBe('tp1');
  });
});

describe('setupHash', () => {
  it('is stable while the levels hold and changes when they move', () => {
    const base = { source: 'plan' as const, direction: 'long' as const, entryMid: 100, stopLoss: 98, takeProfit: [104, 108] as [number, number] };

    expect(setupHash(base)).toBe(setupHash({ ...base, entryMid: 100.001 }));
    expect(setupHash(base)).not.toBe(setupHash({ ...base, stopLoss: 97.5 }));
  });
});
