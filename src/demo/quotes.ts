// Deliberately mocked market data — the point of this demo is the payment
// rail, not a real price feed. Same trade-off the bounty's own reference
// architecture (x402-hedera-example) makes with its mock provider.

const BASE_PRICES: Record<string, number> = {
  BTC: 68000,
  ETH: 3400,
  HBAR: 0.07,
};

export const SYMBOLS = Object.keys(BASE_PRICES);

export function getQuote(symbol: string) {
  const base = BASE_PRICES[symbol.toUpperCase()];
  if (base === undefined) return null;
  const jitter = 1 + (Math.random() - 0.5) * 0.01;
  return {
    symbol: symbol.toUpperCase(),
    price: Number((base * jitter).toFixed(symbol.toUpperCase() === "HBAR" ? 5 : 2)),
    currency: "USD",
    asOf: new Date().toISOString(),
  };
}
