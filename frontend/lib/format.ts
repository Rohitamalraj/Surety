import { formatUnits, parseUnits } from "viem";
import { EXPLORER, USDC_DECIMALS } from "./config";

/** MockUSDC base units (decimal string or bigint) → "1,234.56". */
export function usdc(v: string | bigint | undefined | null, digits = 2): string {
  if (v === undefined || v === null || v === "") return "—";
  const n = Number(formatUnits(BigInt(v), USDC_DECIMALS));
  return n.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

export const toUnits = (human: string | number) => parseUnits(String(human || 0), USDC_DECIMALS);

export const short = (a?: string | null, head = 6, tail = 4) =>
  !a ? "—" : a.length <= head + tail + 2 ? a : `${a.slice(0, head)}…${a.slice(-tail)}`;

export function ago(unix: number): string {
  const s = Math.max(0, Math.floor(Date.now() / 1000) - unix);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export const txUrl = (hash?: string) => (EXPLORER && hash ? `${EXPLORER}/tx/${hash}` : null);
export const addrUrl = (a?: string) => (EXPLORER && a ? `${EXPLORER}/address/${a}` : null);

export const pct = (wad: number, digits = 2) => `${(wad * 100).toFixed(digits)}%`;
