import "dotenv/config";
import { createClientHederaSigner, HBAR_ASSET_ID } from "@x402/hedera";
import { parseHederaPrivateKey } from "../src/signer.js";

// End-to-end smoke test: builds a real signed HBAR payment and posts it
// straight to this facilitator's /verify then /settle. Requires a second
// funded testnet account to act as the payer (see README "Getting testnet
// accounts" — you can mint one for free from an existing funded account
// with the Hedera SDK's AccountCreateTransaction).

async function main() {
  const facilitatorUrl = process.env.FACILITATOR_URL || `http://localhost:${process.env.PORT || 4021}`;
  const payTo = process.env.HEDERA_FACILITATOR_ID!;
  const payerAccountId = process.env.PAYER_ACCOUNT_ID;
  const payerKeyStr = process.env.PAYER_PRIVATE_KEY;

  if (!payerAccountId || !payerKeyStr) {
    throw new Error("Set PAYER_ACCOUNT_ID / PAYER_PRIVATE_KEY (a second funded testnet account) first — see README.");
  }

  const requirements = {
    scheme: "exact",
    network: "hedera:testnet",
    asset: HBAR_ASSET_ID,
    amount: "100000000", // 1 HBAR
    payTo,
    maxTimeoutSeconds: 180,
    extra: { feePayer: payTo },
  };

  const signer = createClientHederaSigner(payerAccountId, parseHederaPrivateKey(payerKeyStr), { network: "hedera:testnet" });
  const transaction = await signer.createPartiallySignedTransferTransaction(requirements as any);
  const paymentPayload = {
    x402Version: 2,
    scheme: "exact",
    network: "hedera:testnet",
    payload: { transaction },
    accepted: requirements,
  };

  console.log(`Paying 1 HBAR from ${payerAccountId} to ${payTo} via ${facilitatorUrl}...`);

  const verifyRes = await fetch(`${facilitatorUrl}/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements: requirements }),
  });
  console.log("verify:", await verifyRes.json());

  const settleRes = await fetch(`${facilitatorUrl}/settle`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ x402Version: 2, paymentPayload, paymentRequirements: requirements }),
  });
  console.log("settle:", await settleRes.json());
}

main().catch((err) => {
  console.error("FAILED:", err);
  process.exit(1);
});
