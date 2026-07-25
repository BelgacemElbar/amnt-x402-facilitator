# hedera-x402-facilitator

A minimal, self-hostable **[x402](https://x402.org)** payment facilitator for **Hedera**.

x402 lets an AI agent (or any HTTP client) pay for an API call inline, over plain HTTP, using the `402 Payment Required` status code — no accounts, no API keys, no session. A **facilitator** is the piece of that protocol that actually checks and settles the payment: a resource server hands it a signed payment, and the facilitator verifies it (signature, amount, balance) and submits it to the network.

This one runs on Hedera, in either direction — testnet or mainnet — and speaks the standard x402 facilitator HTTP contract, so any x402-compliant resource server can point at it with zero code changes.

## Why this exists

Hedera has been actively pushing x402 as the payment rail for AI agent commerce, but the only public facilitator for Hedera ([blocky402](https://blocky402.com)) only runs on testnet. There's no public mainnet facilitator for Hedera today. This fills that gap — self-hostable, so anyone can run their own instead of depending on a single third party.

It's a thin wrapper: almost all the actual protocol logic (signature verification, balance/association preflight checks, transaction inspection) comes straight from Hedera's own [`@x402/hedera`](https://www.npmjs.com/package/@x402/hedera) and [`@x402/core`](https://www.npmjs.com/package/@x402/core) SDKs. This repo is the ~100 lines of glue that turn those into a running HTTP service, plus the setup, testing, and debugging notes it took to get there.

## Quickstart

```bash
git clone https://github.com/belgacemelbar/hedera-x402-facilitator.git
cd hedera-x402-facilitator
npm install
cp .env.example .env
```

Fill in `.env` with a funded Hedera account (free on testnet — see below), then:

```bash
npm run dev
```

```
hedera-x402-facilitator listening on http://localhost:4021 (hedera:testnet, fee-payer 0.0.xxxxxxx)
```

Point any x402 resource server's `HTTPFacilitatorClient` at `http://localhost:4021` (or wherever you deploy this) instead of a third-party facilitator, and it just works.

### Getting testnet accounts

1. **Fee-payer account** (this facilitator's identity): sign up at the [Hedera Portal](https://portal.hedera.com/), create a testnet account, claim free test HBAR.
2. **A second account to test payments with**: you don't need to sign up again — mint one for free from your funded account with the Hedera SDK:

   ```ts
   import { AccountId, Client, Hbar, PrivateKey, AccountCreateTransaction } from "@hiero-ledger/sdk";

   const client = Client.forTestnet().setOperator(
     AccountId.fromString(process.env.HEDERA_FACILITATOR_ID!),
     PrivateKey.fromStringECDSA(process.env.HEDERA_FACILITATOR_KEY!),
   );
   const newKey = PrivateKey.generateECDSA();
   const receipt = await (
     await new AccountCreateTransaction().setKeyWithoutAlias(newKey.publicKey).setInitialBalance(new Hbar(50)).execute(client)
   ).getReceipt(client);

   console.log(receipt.accountId!.toString(), newKey.toStringDer());
   ```

## API

Matches `@x402/core`'s `HTTPFacilitatorClient` contract exactly.

| Endpoint | Method | Description |
|---|---|---|
| `/verify` | `POST` | Checks a signed payment payload against payment requirements. Returns `{ isValid, payer }` or `{ isValid: false, invalidReason }`. |
| `/settle` | `POST` | Submits a verified payment on-chain. Returns `{ success, transaction, network, payer }`. |
| `/supported` | `GET` | Advertises which scheme/network/fee-payer this facilitator serves — resource servers call this on startup to validate their route config. |

Both `/verify` and `/settle` expect the same request body shape:

```json
{
  "x402Version": 2,
  "paymentPayload": { "...": "signed payment from the client SDK" },
  "paymentRequirements": { "...": "what the resource server is charging" }
}
```

### Wiring up a resource server

```ts
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { HBAR_ASSET_ID } from "@x402/hedera";

const server = new x402ResourceServer(
  new HTTPFacilitatorClient({ url: "http://localhost:4021" }) // ← this facilitator
).register("hedera:testnet", new ExactHederaScheme());

// route price MUST be an explicit AssetAmount, not a bare number/string —
// otherwise the default money parser resolves to USDC, not HBAR:
price: () => ({ asset: HBAR_ASSET_ID, amount: "500000000" }) // 5 HBAR, in tinybars
```

## Testing it end to end

```bash
npm run test:payment
```

This builds a real signed 1 HBAR payment from `PAYER_ACCOUNT_ID` and posts it through `/verify` then `/settle` against your running facilitator — settling for real on whichever network you configured. Needs `PAYER_ACCOUNT_ID` / `PAYER_PRIVATE_KEY` set in `.env` (see "Getting testnet accounts" above; use a **different** account than the fee-payer — paying yourself nets to a zero-amount transfer and fails verification).

## Going to mainnet

Set `HEDERA_FACILITATOR_NETWORK=hedera:mainnet` and point `HEDERA_FACILITATOR_ID` / `HEDERA_FACILITATOR_KEY` at a **mainnet** account funded with real HBAR. This account pays real network fees and settles real payments — treat the private key accordingly (secrets manager, not a `.env` file, in production).

## Notes from building this

A few non-obvious things that cost real debugging time, in case they save you some:

- **`price` must be an `AssetAmount`, not a bare number.** A route config like `price: () => "500000000"` gets run through the scheme's default money parser, which resolves to testnet/mainnet **USDC**, not HBAR, when no `defaultAssets` are configured. Pass `{ asset: "0.0.0", amount: "..." }` explicitly to charge in HBAR.
- **`.register()` wants a concrete network, not the `hedera:*` wildcard.** `x402Facilitator.register("hedera:*", scheme)` gets advertised verbatim in `GET /supported`, and a resource server validates its route's declared network against that list with an exact string match — so a literal `"hedera:*"` never matches `"hedera:testnet"` and route initialization fails. Register the concrete network(s) you actually support.
- **Key parsing: try ECDSA/ED25519 before DER.** `PrivateKey.fromStringDer()` can silently mis-parse a raw hex key (no DER prefix) into the wrong key material instead of throwing — producing a signer that looks valid but signs with the wrong bytes. The Hedera SDK's own runtime warning says the same thing.
- **In Next.js App Router**, a facilitator exposing sub-paths (`/verify`, `/settle`, `/supported`) needs a catch-all route segment (`app/api/facilitator/[[...route]]/route.ts`) — a plain `route.ts` only matches the exact base path.

## License

MIT
