# Changelog

## 1.0.0 — 2026-09-14

Renamed from `hedera-x402-facilitator`. GitHub redirects the old URL.

### Added
- **Solana and EVM chains** next to Hedera. A chain is on when its fee-payer key is set.
- **Settlement log** in SQLite (default) or Postgres (`DATABASE_URL`).
- `GET /health`, `GET /stats`, `GET /transactions`, `GET /discovery/resources`.
- **Dashboard** at `/dashboard`.
- **Guards:** replayed payments are refused (`already_settled`), plus `MIN_AMOUNT_ATOMIC`, `PAY_TO_ALLOWLIST` and `RATE_LIMIT_PER_MINUTE`.
- Dockerfile, `npx github:BelgacemElbar/amnt-x402-facilitator`, unit tests, CI and a daily testnet end-to-end run.

### Fixed (ported from production at amnt.io)
- The Hedera key type is read from the ledger and checked before signing. A guessed type caused an `INVALID_SIGNATURE` outage.
- Malformed requests return `400` with the reason instead of `500`.
- A failed startup is no longer cached for the life of a serverless instance.
- One Hedera client per network: settling went from 16 s to about 6 s.

### Removed
- The pay-per-call demo. The [quickstart](https://docs.amnt.io/docs/facilitator/quickstart) replaces it.

### Changed
- `HEDERA_FACILITATOR_NETWORK` is now `HEDERA_NETWORK`. The old name still works.
- Default port is `3000`.

## 0.1.0 — 2026-07-31

First release: a Hedera-only facilitator with `/verify`, `/settle` and `/supported`, plus a demo.
