/**
 * Pay and settle 0.001 testnet USDC on each testnet through a running facilitator.
 * `npm run e2e:testnet`   (CI runs it daily - see .github/workflows/e2e-testnet.yml)
 *
 *   E2E_FACILITATOR_URL      default https://testnet.facilitator.amnt.io
 *   E2E_EVM_BUYER_KEY        Base Sepolia buyer (needs USDC)
 *   E2E_SOLANA_BUYER_KEY     Solana devnet buyer, base58 (needs USDC)
 *   E2E_HEDERA_BUYER_ID/KEY  Hedera testnet buyer (needs USDC)
 *
 * A chain is skipped when its buyer isn't set. Testnet funds only.
 */
import "dotenv/config";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { ExactSvmScheme } from "@x402/svm/exact/client";
import { ExactHederaScheme } from "@x402/hedera/exact/client";
import { createClientHederaSigner, PrivateKey } from "@x402/hedera";
import { SOLANA_DEVNET_CAIP2 } from "@x402/svm";
import { createKeyPairSignerFromBytes, getBase58Encoder } from "@solana/kit";
import { privateKeyToAccount } from "viem/accounts";

const FAC = (process.env.E2E_FACILITATOR_URL || "https://testnet.facilitator.amnt.io").replace(/\/$/, "");
const env = (n: string) => (process.env[n] || "").trim();
const USDC: Record<string, string> = {
  "eip155:84532": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  [SOLANA_DEVNET_CAIP2]: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  "hedera:testnet": "0.0.429274",
};

const buyers: { network: string; scheme: any; extra?: object }[] = [];
if (env("E2E_EVM_BUYER_KEY")) {
  const k = env("E2E_EVM_BUYER_KEY");
  // Base Sepolia USDC signs as "USDC"; Base mainnet as "USD Coin".
  buyers.push({ network: "eip155:84532", scheme: new ExactEvmScheme(privateKeyToAccount((k.startsWith("0x") ? k : `0x${k}`) as `0x${string}`)), extra: { name: "USDC", version: "2" } });
}
if (env("E2E_SOLANA_BUYER_KEY")) {
  buyers.push({ network: SOLANA_DEVNET_CAIP2, scheme: new ExactSvmScheme(await createKeyPairSignerFromBytes(getBase58Encoder().encode(env("E2E_SOLANA_BUYER_KEY")) as Uint8Array)) });
}
if (env("E2E_HEDERA_BUYER_ID") && env("E2E_HEDERA_BUYER_KEY")) {
  const signer = createClientHederaSigner(env("E2E_HEDERA_BUYER_ID"), PrivateKey.fromStringECDSA(env("E2E_HEDERA_BUYER_KEY").replace(/^0x/, "")), { network: "hedera:testnet" } as any);
  buyers.push({ network: "hedera:testnet", scheme: new ExactHederaScheme(signer) });
}
if (!buyers.length) {
  console.log("No E2E_* buyer keys set. Nothing to test.");
  process.exit(0);
}

const post = async (path: string, body: unknown) => (await fetch(`${FAC}${path}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json() as Promise<any>;
const supported: any = await (await fetch(`${FAC}/supported`)).json();
let failed = false;

for (const b of buyers) {
  const kind = supported.kinds.find((k: any) => k.network === b.network);
  const payTo = kind?.extra?.feePayer ?? supported.signers?.[`${b.network.split(":")[0]}:*`]?.[0];
  if (!kind || !payTo) {
    console.log(`❌ ${b.network}: not in ${FAC}/supported`);
    failed = true;
    continue;
  }
  const req = { scheme: "exact", network: b.network, asset: USDC[b.network], amount: "1000", payTo, maxTimeoutSeconds: 180, extra: { ...b.extra, ...kind.extra } };
  try {
    const client = new x402Client().register(b.network as any, b.scheme);
    const payload = await client.createPaymentPayload({ x402Version: 2, resource: { url: "https://github.com/BelgacemElbar/amnt-x402-facilitator#e2e" }, accepts: [req] } as any);
    const v = await post("/verify", { paymentPayload: payload, paymentRequirements: req });
    if (!v.isValid) throw new Error(`verify: ${v.invalidMessage || v.invalidReason}`);
    const s = await post("/settle", { paymentPayload: payload, paymentRequirements: req });
    if (!s.success) throw new Error(`settle: ${s.errorMessage || s.errorReason}`);
    const again = await post("/settle", { paymentPayload: payload, paymentRequirements: req });
    if (again.errorReason !== "already_settled") throw new Error(`a replay was not refused: ${JSON.stringify(again)}`);
    console.log(`✅ ${b.network}: settled ${s.transaction}, replay refused`);
  } catch (err: any) {
    console.log(`❌ ${b.network}: ${String(err?.message || err).slice(0, 300)}`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
