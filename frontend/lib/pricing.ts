/**
 * PRD §14 — the exact formula in contracts/src/PricingEngine.sol, mirrored for the live breakdown.
 * The contract is the source of truth (fixed-point); this is for display, and matches the
 * §14.1 fixtures: 625.00 / 133.33 / 890.63 USDC.
 */
export const K = 10;
export const LAMBDA_PRIOR = 0.05;
export const STREAK_STEP = 0.01;
export const MAX_STREAK_DISC = 0.2;
export const TIER_LOAD = [1.5, 1.25, 1.0] as const;

export interface QuoteInput {
  coverage: number; // human USDC
  tier: 0 | 1 | 2;
  streak: number;
  claims: number;
  periods: number;
}

export interface Quote {
  z: number;
  lambdaAgent: number;
  lambdaPost: number;
  tierLoad: number;
  streakDisc: number;
  premium: number; // human USDC
}

export function quote({ coverage, tier, streak, claims, periods }: QuoteInput): Quote {
  const n = Math.max(0, periods);
  const z = n / (n + K);
  const lambdaAgent = claims / Math.max(n, 1);
  const lambdaPost = z * lambdaAgent + (1 - z) * LAMBDA_PRIOR;
  const tierLoad = TIER_LOAD[tier];
  const streakDisc = Math.min(streak * STREAK_STEP, MAX_STREAK_DISC);
  const premium = coverage * lambdaPost * tierLoad * (1 - streakDisc);
  return { z, lambdaAgent, lambdaPost, tierLoad, streakDisc, premium };
}

/** PRD §14.2 — tighter rules unlock cheaper tiers because enforcement bounds the max loss. */
export function maxTier(coverage: number, perTxCap: number, allowlistLength: number): 0 | 1 | 2 {
  if (allowlistLength > 0 && perTxCap * 20 <= coverage) return 2;
  if (perTxCap * 5 <= coverage) return 1;
  return 0;
}

export const TIER_NAMES = ["Open", "Capped", "Locked-down"] as const;
