import { Hono } from "hono";
import { x402Facilitator } from "@x402/core/facilitator";
import { ExactHederaScheme } from "@x402/hedera/exact/facilitator";
import { createFacilitatorSigner } from "./signer.js";

// A minimal, self-hostable x402 payment facilitator for Hedera.
//
// A facilitator is the piece of the x402 protocol that actually checks and
// settles a payment: a resource server (an API that charges per-request)
// hands it a signed payment payload, and the facilitator verifies the
// signature/amount/balance, then submits the transfer to the network.
//
// Wire protocol matches @x402/core's HTTPFacilitatorClient exactly — any
// x402-compliant resource server can point at this with no code changes:
//   POST /verify     — checks a signed payment against requirements
//   POST /settle     — submits a verified payment on-chain
//   GET  /supported   — advertises which scheme/network/fee-payer this serves

export function createFacilitatorApp() {
  const network = (process.env.HEDERA_FACILITATOR_NETWORK || "hedera:testnet") as
    | "hedera:testnet"
    | "hedera:mainnet";
  const accountId = process.env.HEDERA_FACILITATOR_ID;
  const privateKey = process.env.HEDERA_FACILITATOR_KEY;

  if (!accountId || !privateKey) {
    throw new Error(
      "Missing HEDERA_FACILITATOR_ID / HEDERA_FACILITATOR_KEY — copy .env.example to .env and fill them in.",
    );
  }

  const signer = createFacilitatorSigner(accountId, privateKey);
  const facilitator = new x402Facilitator().register(network, new ExactHederaScheme(signer));

  const app = new Hono();

  app.post("/verify", async (c) => {
    const { paymentPayload, paymentRequirements } = await c.req.json();
    const result = await facilitator.verify(paymentPayload, paymentRequirements);
    if (!result.isValid) console.warn("[facilitator] verify rejected:", result);
    return c.json(result);
  });

  app.post("/settle", async (c) => {
    const { paymentPayload, paymentRequirements } = await c.req.json();
    const result = await facilitator.settle(paymentPayload, paymentRequirements);
    if (!result.success) console.warn("[facilitator] settle failed:", result);
    else console.log("[facilitator] settled:", result.transaction);
    return c.json(result);
  });

  app.get("/supported", (c) => c.json(facilitator.getSupported()));

  return { app, network, accountId };
}
