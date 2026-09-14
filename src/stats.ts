import { createHash } from "node:crypto";
import type { Row } from "./store.js";

/**
 * Totals, a daily series and splits from settle rows.
 * ponytail: aggregated in JS over the window; fine to ~100k rows a window, move to SQL past that.
 */
export function computeStats(rows: Row[], days: number, now = new Date()) {
  const settled = rows.filter((r) => r.status === "settled");
  const sum = (rs: Row[]) => rs.reduce((s, r) => s + BigInt(r.amount_atomic || "0"), 0n);
  const volume = sum(settled);
  const ms = settled.map((r) => r.total_ms).filter((m): m is number => typeof m === "number").sort((a, b) => a - b);
  const median = ms.length ? (ms.length % 2 ? ms[(ms.length - 1) / 2] : (ms[ms.length / 2 - 1] + ms[ms.length / 2]) / 2) : null;
  const count = <K extends string>(rs: Row[], key: (r: Row) => K) => rs.reduce<Record<string, number>>((o, r) => ((o[key(r)] = (o[key(r)] || 0) + 1), o), {});

  const daily = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - i)).toISOString().slice(0, 10);
    const on = settled.filter((r) => r.created_at.slice(0, 10) === day);
    daily.push({ day, count: on.length, volumeAtomic: sum(on).toString() });
  }

  return {
    settlements: settled.length,
    failed: rows.filter((r) => r.status === "failed").length,
    volumeAtomic: volume.toString(),
    successRate: rows.length ? Math.round((1000 * settled.length) / rows.length) / 10 : null,
    avgAtomic: settled.length ? (volume / BigInt(settled.length)).toString() : "0",
    medianSettleMs: median,
    payers: new Set(settled.map((r) => r.payer)).size,
    daily,
    byNetwork: count(settled, (r) => r.network),
    byStatus: count(rows, (r) => r.status),
  };
}

/** One fingerprint per signed payment: the signed transaction bytes, whatever the chain. */
export function paymentHash(paymentPayload: any): string | null {
  const inner = paymentPayload?.payload;
  if (!inner) return null;
  const bytes = typeof inner.transaction === "string" ? inner.transaction : JSON.stringify(inner);
  return createHash("sha256").update(bytes).digest("hex");
}
