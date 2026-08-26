/**
 * Position sizing, mirroring the rules already encoded in
 * `api/risk_manager.py` (MAX_RISK = 1% of capital, MIN_RR = 1.5).
 *
 * Kept client-side on purpose: the numbers change on every edit of the
 * entry/stop levels, and a round-trip per keystroke would be absurd. The
 * constants live in both places — if they change in `risk_manager.py`, change
 * them here too.
 */

export const MAX_RISK = 0.01;
export const MIN_RR = 1.5;

export type TradePlan = {
  approved: boolean;
  riskReward: number;
  shares: number;
  riskAmount: number;
  riskPerShare: number;
  /** Why the plan was rejected, when it was. */
  reason?: string;
};

export function planTrade(
  entry: number,
  stop: number,
  target: number,
  capital: number,
  /** Fraction of capital at risk; the panel lets the user move it off the 1% default. */
  maxRisk = MAX_RISK
): TradePlan {
  const riskPerShare = Math.abs(entry - stop);
  const rewardPerShare = Math.abs(target - entry);
  const riskAmount = capital * maxRisk;

  if (!Number.isFinite(riskPerShare) || riskPerShare <= 0) {
    return {
      approved: false,
      riskReward: 0,
      shares: 0,
      riskAmount,
      riskPerShare: 0,
      reason: 'Stop must differ from entry',
    };
  }

  const riskReward = +(rewardPerShare / riskPerShare).toFixed(2);
  const shares = Math.floor(riskAmount / riskPerShare);

  if (riskReward < MIN_RR) {
    return {
      approved: false,
      riskReward,
      shares,
      riskAmount,
      riskPerShare,
      reason: `R:R ${riskReward} below the ${MIN_RR} minimum`,
    };
  }

  if (shares < 1) {
    return {
      approved: false,
      riskReward,
      shares: 0,
      riskAmount,
      riskPerShare,
      reason: `Risk per share exceeds ${(maxRisk * 100).toFixed(2)}% of capital`,
    };
  }

  return { approved: true, riskReward, shares, riskAmount, riskPerShare };
}
