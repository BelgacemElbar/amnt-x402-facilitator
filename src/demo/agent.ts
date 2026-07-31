import { wrapFetchWithPayment } from "@x402/fetch";
import { createClientHederaSigner, PrivateKey as HederaPrivateKey } from "@x402/hedera";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { x402Client, x402HTTPClient } from "@x402/core/client";
import type { Network } from "@x402/core/types";

export type DemoStep = {
  label: string;
  detail: string;
};

export type DemoResult = {
  steps: DemoStep[];
  quote: unknown;
  settlement: { success: boolean; transaction?: string; payer?: string } | null;
  hashscanUrl: string | null;
};

// Runs the exact same code path a real autonomous agent would run: an
// unpaid probe to see the price, then a payment-aware fetch that signs and
// settles automatically on a 402. The only thing "demo" about this is that
// a button click stands in for an agent's own decision to buy the data —
// the request/sign/verify/settle sequence below is the real protocol flow.
export async function runDemoPurchase(
  origin: string,
  symbol: string,
  asset: "hbar" | "usdc" = "hbar",
): Promise<DemoResult> {
  const network = (process.env.HEDERA_FACILITATOR_NETWORK || "hedera:testnet") as Network;
  const agentId = process.env.DEMO_AGENT_ID;
  const agentKey = process.env.DEMO_AGENT_KEY;
  if (!agentId || !agentKey) throw new Error("Missing DEMO_AGENT_ID / DEMO_AGENT_KEY");

  const path = asset === "usdc" ? "quote-usdc" : "quote";
  const url = `${origin}/demo/api/${path}/${symbol}`;
  const steps: DemoStep[] = [];

  const httpClient = new x402HTTPClient(new x402Client());

  const probe = await fetch(url);
  if (probe.status === 402) {
    const required = httpClient.getPaymentRequiredResponse((name) => probe.headers.get(name));
    const accept = required.accepts[0];
    const amount = accept ? formatAssetAmount(accept.amount, asset) : undefined;
    steps.push({
      label: "Requested quote without payment",
      detail: amount
        ? `Server replied 402 Payment Required — wants ${amount} to ${accept.payTo}`
        : "Server replied 402 Payment Required",
    });
  } else {
    steps.push({ label: "Requested quote without payment", detail: `Unexpected status ${probe.status}` });
  }

  const signer = createClientHederaSigner(agentId, HederaPrivateKey.fromStringECDSA(agentKey), { network });
  const client = new x402Client().register("hedera:*", new ExactHederaScheme(signer));
  const fetchWithPayment = wrapFetchWithPayment(fetch, client);
  const payingHttpClient = new x402HTTPClient(client);

  steps.push({
    label: "Agent signs a Hedera transfer",
    detail: `${asset === "usdc" ? "HTS token transfer" : "HBAR transfer"} signed with ${agentId}'s key — co-signed and submitted by the facilitator's fee-payer account`,
  });

  const res = await fetchWithPayment(url);
  const quote = await res.json();

  const settleResponse = payingHttpClient.getPaymentSettleResponse((name) => res.headers.get(name));
  const settlement = settleResponse
    ? { success: settleResponse.success, transaction: settleResponse.transaction, payer: settleResponse.payer }
    : null;

  if (settlement?.transaction) {
    steps.push({
      label: "Facilitator verified and settled on-chain",
      detail: `Transaction ${settlement.transaction} — real testnet transfer, not simulated`,
    });
  } else {
    steps.push({ label: "Facilitator processed the payment", detail: `HTTP ${res.status}` });
  }

  const hashscanUrl = settlement?.transaction ? toHashscanUrl(settlement.transaction) : null;

  return { steps, quote, settlement, hashscanUrl };
}

function formatAssetAmount(amount: string, asset: "hbar" | "usdc"): string {
  const decimals = asset === "usdc" ? 6 : 8;
  const unit = asset === "usdc" ? "tUSDC" : "HBAR";
  return `${Number(amount) / 10 ** decimals} ${unit}`;
}

// Hedera tx ids look like "0.0.9510357@1785493749.860677185";
// HashScan URLs use dashes: "0.0.9510357-1785493749-860677185".
function toHashscanUrl(transactionId: string): string {
  const normalized = transactionId.replace("@", "-").replace(/\.(\d+)$/, "-$1");
  const network = (process.env.HEDERA_FACILITATOR_NETWORK || "hedera:testnet").includes("mainnet")
    ? "mainnet"
    : "testnet";
  return `https://hashscan.io/${network}/transaction/${normalized}`;
}
