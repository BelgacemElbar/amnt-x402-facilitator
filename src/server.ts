import "dotenv/config";
import { serve } from "@hono/node-server";
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

const PORT = Number(process.env.PORT || 4021);
const NETWORK = (process.env.HEDERA_FACILITATOR_NETWORK || "hedera:testnet") as "hedera:testnet" | "hedera:mainnet";
const ACCOUNT_ID = process.env.HEDERA_FACILITATOR_ID;
const PRIVATE_KEY = process.env.HEDERA_FACILITATOR_KEY;

if (!ACCOUNT_ID || !PRIVATE_KEY) {
  console.error("Missing HEDERA_FACILITATOR_ID / HEDERA_FACILITATOR_KEY — copy .env.example to .env and fill them in.");
  process.exit(1);
}

const signer = createFacilitatorSigner(ACCOUNT_ID, PRIVATE_KEY);
const facilitator = new x402Facilitator().register(NETWORK, new ExactHederaScheme(signer));

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

app.get("/", (c) => c.json({ name: "hedera-x402-facilitator", network: NETWORK, feePayer: ACCOUNT_ID }));

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`hedera-x402-facilitator listening on http://localhost:${info.port} (${NETWORK}, fee-payer ${ACCOUNT_ID})`);
});
