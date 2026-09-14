# amnt-x402-facilitator

**An open-source [x402](https://x402.org) payment facilitator for Hedera, EVM chains and Solana.** It checks and settles USDC payments for any x402 server, pays the network fee, logs every settlement and ships its own dashboard.

- ✅ **Hosted, free:** mainnet `https://facilitator.amnt.io` (Hedera) · testnet `https://testnet.facilitator.amnt.io` (Hedera, Base Sepolia, Solana devnet)
- 📊 **Live dashboard:** [amnt.io/facilitators/hedera-x402-facilitator](https://www.amnt.io/facilitators/hedera-x402-facilitator)
- 📝 **Docs:** [docs.amnt.io/docs/facilitator](https://docs.amnt.io/docs/facilitator)

The code here is what runs those hosted endpoints.

## Use the hosted one

Point your x402 server's facilitator at the URL. Nothing else changes: the API is the same as Coinbase's.

```ts
import { HTTPFacilitatorClient } from "@x402/core/server";

const facilitator = new HTTPFacilitatorClient({ url: "https://testnet.facilitator.amnt.io" });
```

Full walkthrough: [quickstart](https://docs.amnt.io/docs/facilitator/quickstart).

## Run your own

```bash
git clone https://github.com/BelgacemElbar/amnt-x402-facilitator
cd amnt-x402-facilitator
npm install
cp .env.example .env    # add at least one fee-payer key
npm start               # http://localhost:3000, dashboard at /dashboard
```

Or:

```bash
npx github:BelgacemElbar/amnt-x402-facilitator
```

```bash
docker build -t amnt-x402-facilitator .
docker run -p 3000:3000 -v "$PWD/data:/app/data" --env-file .env amnt-x402-facilitator
```

**Vercel:** deploys as-is. Set `DATABASE_URL` to Postgres, because serverless disks don't keep a SQLite file.

Needs Node 22.13 or newer.

## Turn chains on

A chain is on when its fee-payer key is set.

| Variable | What it does |
| --- | --- |
| `HEDERA_FACILITATOR_ID`, `HEDERA_FACILITATOR_KEY` | Hedera fee payer. The key is checked against the ledger at startup. |
| `HEDERA_NETWORK` | `hedera:testnet` (default) or `hedera:mainnet` |
| `EVM_FACILITATOR_KEY` | EVM fee payer, needs gas on each chain |
| `EVM_NETWORKS` | Comma-separated CAIP-2 ids, default `eip155:84532` (Base Sepolia) |
| `EVM_RPC_URL_<chainId>` | Optional RPC per chain |
| `SOLANA_FACILITATOR_KEY` | Solana fee payer, base58 or JSON bytes, needs SOL |
| `SOLANA_NETWORK` | `devnet` (default) or `mainnet` |
| `SOLANA_RPC_URL` | Optional RPC |

## API

| Endpoint | What it does |
| --- | --- |
| `POST /verify` | Checks a signed payment. No money moves. |
| `POST /settle` | Signs as fee payer, sends it, waits for confirmation. |
| `GET /supported` | Networks and fee payers. |
| `GET /health` | `200` when every fee payer can pay, `503` when one is low. |
| `GET /stats?env=&network=&days=` | Totals, daily series, splits. |
| `GET /transactions?env=&network=&status=&cursor=` | The settlement log, newest first. |
| `GET /discovery/resources` | Resources that asked to be discoverable, Bazaar format. |
| `GET /dashboard` | The dashboard. |

Details: [API reference](https://docs.amnt.io/docs/facilitator/api).

## ⚠️ Before you run it on mainnet

A public facilitator pays the fee on every payment anyone sends it, including spam. Use the guards:

| Variable | Default | Effect |
| --- | --- | --- |
| `MIN_AMOUNT_ATOMIC` | `0` | Refuse payments below this many atomic units |
| `PAY_TO_ALLOWLIST` | empty | Only settle for these payees |
| `RATE_LIMIT_PER_MINUTE` | `120` | Settlements a minute per payee, per process. `0` turns it off. |

A payment that already settled is always refused as `already_settled`.

## Storage

SQLite at `./data/facilitator.db` by default (Node's built-in `node:sqlite`). Set `DATABASE_URL` for Postgres. Tables are created on startup.

## Develop

```bash
npm test             # unit tests, no chain needed
npm run typecheck
npm run e2e:testnet  # real testnet payments; see scripts/e2e-testnet.ts for the E2E_* variables
```

## How it's built

Verification and settlement come from the official `@x402/hedera`, `@x402/evm` and `@x402/svm` packages. This repo is the service around them:

```
src/chains/   one file per chain family, plus the registry that turns env vars into fee payers
src/app.ts    the HTTP API and the guards
src/store.ts  SQLite and Postgres
src/stats.ts  aggregates
src/dashboard.ts
```

MIT licensed. Built and run by [AMNT](https://www.amnt.io).
