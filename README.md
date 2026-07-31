# hedera-x402-facilitator

A minimal, self-hostable **[x402](https://x402.org)** payment facilitator for **Hedera** — plus a live pay-per-call demo running on top of it.

**🔴 Live: [hedera-x402-facilitator.vercel.app](https://hedera-x402-facilitator.vercel.app)** — click the button, watch a real autonomous agent pay a resource server through this facilitator, and get a real testnet transaction back.

Sample real transactions from that demo, verifiable on HashScan:

- HBAR payment: [`0.0.9510357-1785494891-519446891`](https://hashscan.io/testnet/transaction/0.0.9510357-1785494891-519446891)
- HTS token (demo stablecoin) payment: [`0.0.9510357-1785495965-801601008`](https://hashscan.io/testnet/transaction/0.0.9510357-1785495965-801601008)

## What's in this repo

x402 lets an AI agent (or any HTTP client) pay for an API call inline, over plain HTTP, using the `402 Payment Required` status code — no accounts, no API keys, no session. Three roles make that work:

1. **Client** — the agent that wants the data and is willing to pay for it.
2. **Resource server** — the API charging per request.
3. **Facilitator** — verifies the signed payment and settles it on-chain, so the resource server never touches keys or chain logic itself.

This repo ships both **#3, the facilitator** (`src/facilitator/`) and, on top of it, a small **#1 + #2 demo** (`src/demo/`) so the facilitator's HTTP contract has something real exercising it end to end instead of sitting there unverified. The demo's resource server is a genuine HTTP client of this facilitator's `/verify` + `/settle` — it isn't wired in-process, so it proves the facilitator's contract really works for any x402 resource server, including this one.

The facilitator itself runs on Hedera, in either direction — testnet or mainnet — and speaks the standard x402 facilitator HTTP contract, so any x402-compliant resource server can point at it with zero code changes.

## Why this exists

Hedera has been actively pushing x402 as the payment rail for AI agent commerce, but the only public facilitator for Hedera ([blocky402](https://blocky402.com)) only runs on testnet. There's no public mainnet facilitator for Hedera today. This fills that gap — self-hostable, so anyone can run their own instead of depending on a single third party.

The facilitator itself is a thin wrapper: almost all the actual protocol logic (signature verification, balance/association preflight checks, transaction inspection) comes straight from Hedera's own [`@x402/hedera`](https://www.npmjs.com/package/@x402/hedera) and [`@x402/core`](https://www.npmjs.com/package/@x402/core) SDKs. `src/facilitator/` is the ~80 lines of glue that turn those into a running HTTP service.

## Architecture

```
src/
  facilitator/    the x402 facilitator: POST /verify, POST /settle, GET /supported
  demo/           a pay-per-call resource server + an auto-paying agent, built on top of it
  app.ts          wires both into one Hono app
api/index.ts      Vercel serverless entrypoint
```

Three separate Hedera testnet accounts play three separate roles, matching how x402 actually separates them (not a simplification for the demo — this is the real architecture):

| Role | Account | What it does |
|---|---|---|
| Facilitator fee-payer | `HEDERA_FACILITATOR_ID` | Co-signs and submits every settled transaction; pays the network fee |
| Demo agent | `DEMO_AGENT_ID` | Signs and pays for quotes — small isolated balance, never the fee-payer |
| Demo merchant | `DEMO_MERCHANT_ID` | Receives the quote payment — distinct from the fee-payer on purpose |

Run the live demo and check the resulting HashScan transaction: you'll see the agent's balance debited, the merchant's balance credited, and the facilitator's fee-payer account charged only the network fee — three separate transfers in one transaction, exactly as designed.

## Quickstart

```bash
git clone https://github.com/BelgacemElbar/hedera-x402-facilitator.git
cd hedera-x402-facilitator
npm install
cp .env.example .env
```

Fill in `.env` with a funded Hedera account (free on testnet — see below), then:

```bash
npm run dev
```

```
hedera-x402-facilitator listening on http://localhost:4021
```

Open `http://localhost:4021` for the live demo page, or point any x402 resource server's `HTTPFacilitatorClient` at that URL (or wherever you deploy this) instead of a third-party facilitator, and it just works.

### Getting testnet accounts

1. **Fee-payer account** (this facilitator's identity): sign up at the [Hedera Portal](https://portal.hedera.com/), create a testnet account, claim free test HBAR.
2. **Additional accounts** (for the demo's agent/merchant roles, or to test payments yourself): you don't need to sign up again — mint one for free from your funded account:

   ```bash
   npx tsx scripts/mint-payer.ts
   ```

   This runs the same `AccountCreateTransaction` flow the Hedera SDK docs recommend — funds a new account with 50 test HBAR from your existing one.

### Optional: the demo's HTS stablecoin path

The live demo can also settle in a demo-only HTS fungible token (`tUSDC`, 6 decimals) to prove the facilitator settles HTS tokens generically, not just HBAR — **it's not Circle's real testnet USDC** (that needs a separate Circle faucet this repo doesn't depend on). To set it up:

```bash
npx tsx scripts/mint-demo-usdc.ts
```

This mints the token, associates the demo agent + merchant accounts, and funds the agent with 100 `tUSDC`. Copy the printed `DEMO_USDC_TOKEN_ID` into `.env`.

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
  new HTTPFacilitatorClient({ url: "https://hedera-x402-facilitator.vercel.app" }) // ← this facilitator, live
).register("hedera:testnet", new ExactHederaScheme());

// route price MUST be an explicit AssetAmount, not a bare number/string —
// otherwise the default money parser resolves to USDC, not HBAR:
price: () => ({ asset: HBAR_ASSET_ID, amount: "500000000" }) // 5 HBAR, in tinybars
```

`src/demo/resource-server.ts` in this repo is a complete working example of exactly this, using [`@x402/hono`](https://www.npmjs.com/package/@x402/hono)'s `paymentMiddleware`.

## Testing it end to end

```bash
npm run test:payment
```

This builds a real signed 1 HBAR payment from `PAYER_ACCOUNT_ID` and posts it through `/verify` then `/settle` against your running facilitator — settling for real on whichever network you configured. Needs `PAYER_ACCOUNT_ID` / `PAYER_PRIVATE_KEY` set in `.env` (see "Getting testnet accounts" above; use a **different** account than the fee-payer — paying yourself nets to a zero-amount transfer and fails verification).

Or just open the app and click the button — that runs the full agent → resource server → facilitator flow through the demo instead.

## Going to mainnet

Set `HEDERA_FACILITATOR_NETWORK=hedera:mainnet` and point `HEDERA_FACILITATOR_ID` / `HEDERA_FACILITATOR_KEY` at a **mainnet** account funded with real HBAR. This account pays real network fees and settles real payments — treat the private key accordingly (secrets manager, not a `.env` file, in production).

## Deploying

The live demo runs on Vercel (Node.js serverless functions) with `vercel --prod`. Required environment variables:

`HEDERA_FACILITATOR_ID`, `HEDERA_FACILITATOR_KEY`, `HEDERA_FACILITATOR_NETWORK`, `DEMO_AGENT_ID`, `DEMO_AGENT_KEY`, `DEMO_MERCHANT_ID`, `DEMO_PRICE_TINYBARS`, and optionally `DEMO_USDC_TOKEN_ID` / `DEMO_USDC_PRICE`.

Any Node host works, not just Vercel — `src/server.ts` is a plain `@hono/node-server` entrypoint.

## Notes from building this

A few non-obvious things that cost real debugging time, in case they save you some:

- **`price` must be an `AssetAmount`, not a bare number.** A route config like `price: () => "500000000"` gets run through the scheme's default money parser, which resolves to testnet/mainnet **USDC**, not HBAR, when no `defaultAssets` are configured. Pass `{ asset: "0.0.0", amount: "..." }` explicitly to charge in HBAR.
- **`.register()` wants a concrete network, not the `hedera:*` wildcard.** `x402Facilitator.register("hedera:*", scheme)` gets advertised verbatim in `GET /supported`, and a resource server validates its route's declared network against that list with an exact string match — so a literal `"hedera:*"` never matches `"hedera:testnet"` and route initialization fails. Register the concrete network(s) you actually support.
- **Key parsing: try ECDSA/ED25519 before DER.** `PrivateKey.fromStringDer()` can silently mis-parse a raw hex key (no DER prefix) into the wrong key material instead of throwing — producing a signer that looks valid but signs with the wrong bytes. The Hedera SDK's own runtime warning says the same thing.
- **In Next.js App Router**, a facilitator exposing sub-paths (`/verify`, `/settle`, `/supported`) needs a catch-all route segment (`app/api/facilitator/[[...route]]/route.ts`) — a plain `route.ts` only matches the exact base path.
- **On Vercel, disable framework auto-detection for a Hono project.** Vercel's build auto-detected "Hono" as the project framework and applied its own auto-discovery convention on top of a hand-written `api/index.ts` entrypoint, causing every request to fail with `Invalid export found in module`. Set `"framework": null` in `vercel.json` to force plain zero-config function routing.
- **Vercel's Node function signature changed.** Newer Vercel Node runtimes want a Web-standard `export function GET(request) { return new Response(...) }`-style handler, not the legacy `(req, res) => void` shape that `hono/vercel`'s `handle()` wraps — using it silently hangs every request until timeout. Export `app.fetch` directly per HTTP method instead (see `api/index.ts`); it already has the right signature.

## License

MIT
