import { test } from "node:test";
import assert from "node:assert/strict";
import { createFacilitatorApp } from "../src/app.ts";
import { sqliteStore } from "../src/store.ts";
import { computeStats, paymentHash } from "../src/stats.ts";
import { envOf, explorerUrl } from "../src/chains/index.ts";

/** A facilitator that approves everything and settles with a counter, so no chain is touched. */
function fake() {
  let n = 0;
  return {
    verify: async () => ({ isValid: true, payer: "0.0.buyer" }),
    settle: async (_p: any, r: any) => ({ success: true, transaction: `tx-${++n}`, network: r.network, payer: "0.0.buyer" }),
    getSupported: () => ({ kinds: [{ x402Version: 2, scheme: "exact", network: "hedera:testnet" }], extensions: [], signers: {} }),
  } as any;
}

const payer = { network: "hedera:testnet", address: "0.0.fee", unit: "HBAR" as const, lowAt: 5, balance: async () => 10 };
const req = { scheme: "exact", network: "hedera:testnet", asset: "0.0.429274", amount: "1000", payTo: "0.0.shop", maxTimeoutSeconds: 180 };
const payload = (id: string) => ({ x402Version: 2, payload: { transaction: id }, resource: { url: "https://api.example.com/weather" } });

async function setup(env: Record<string, string> = {}) {
  const store = await sqliteStore(":memory:");
  const app = createFacilitatorApp({ facilitator: fake(), feePayers: [payer], store, env });
  const post = (path: string, body: unknown) =>
    app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
  return { app, store, post };
}

test("malformed bodies are 400 with the reason, never 500", async () => {
  const { post } = await setup();
  for (const [body, message] of [
    ["not json", "Body must be JSON."],
    [{}, "paymentPayload is required."],
    [{ paymentPayload: {} }, "paymentRequirements is required."],
    [{ paymentPayload: {}, paymentRequirements: {} }, "paymentPayload.x402Version is required."],
  ] as const) {
    const res = await post("/verify", body);
    assert.equal(res.status, 400);
    assert.equal((await res.json()).message, message);
  }
});

test("a settled payment is refused on settle and on verify", async () => {
  const { post } = await setup();
  const p = payload("a");
  const first = await (await post("/settle", { paymentPayload: p, paymentRequirements: req })).json();
  assert.equal(first.success, true);
  const again = await (await post("/settle", { paymentPayload: p, paymentRequirements: req })).json();
  assert.equal(again.errorReason, "already_settled");
  assert.equal(again.transaction, "tx-1");
  const replay = await (await post("/verify", { paymentPayload: p, paymentRequirements: req })).json();
  assert.equal(replay.invalidReason, "already_settled");
});

test("guards: minimum amount, allowlist, rate limit", async () => {
  const min = await setup({ MIN_AMOUNT_ATOMIC: "5000" });
  assert.equal((await (await min.post("/verify", { paymentPayload: payload("b"), paymentRequirements: req })).json()).invalidReason, "amount_below_minimum");

  const allow = await setup({ PAY_TO_ALLOWLIST: "0.0.other" });
  assert.equal((await (await allow.post("/settle", { paymentPayload: payload("c"), paymentRequirements: req })).json()).errorReason, "pay_to_not_allowed");

  const limited = await setup({ RATE_LIMIT_PER_MINUTE: "2" });
  for (const id of ["d", "e"]) assert.equal((await (await limited.post("/settle", { paymentPayload: payload(id), paymentRequirements: req })).json()).success, true);
  assert.equal((await (await limited.post("/settle", { paymentPayload: payload("f"), paymentRequirements: req })).json()).errorReason, "rate_limited");
});

test("every settle and refusal is logged, and /transactions and /stats read it", async () => {
  const { app, post } = await setup();
  await post("/settle", { paymentPayload: payload("g"), paymentRequirements: req });
  await post("/settle", { paymentPayload: payload("g"), paymentRequirements: req });
  const txs = await (await app.request("/transactions?env=testnet")).json();
  assert.deepEqual(txs.transactions.map((t: any) => t.status).sort(), ["rejected", "settled"]);
  assert.equal(txs.transactions.find((t: any) => t.status === "settled").explorer, "https://hashscan.io/testnet/transaction/tx-1");
  const stats = await (await app.request("/stats?env=testnet&days=7")).json();
  assert.equal(stats.settlements, 1);
  assert.equal(stats.volumeAtomic, "1000");
  assert.equal(stats.daily.length, 7);
});

test("/health is 503 when a fee payer is low", async () => {
  const store = await sqliteStore(":memory:");
  const app = createFacilitatorApp({ facilitator: fake(), feePayers: [{ ...payer, balance: async () => 1 }], store });
  const res = await app.request("/health");
  assert.equal(res.status, 503);
  assert.equal((await res.json()).chains[0].lowBalance, true);
});

test("discovery lists mainnet resources that ask for it", async () => {
  const { app, post } = await setup();
  const main = { ...req, network: "hedera:mainnet" };
  await post("/settle", { paymentPayload: { ...payload("h"), extensions: { bazaar: { info: {} } } }, paymentRequirements: main });
  await post("/settle", { paymentPayload: payload("i"), paymentRequirements: main });
  const d = await (await app.request("/discovery/resources")).json();
  assert.equal(d.pagination.total, 1);
  assert.equal(d.items[0].resource, "https://api.example.com/weather");
});

test("helpers", () => {
  assert.equal(envOf("eip155:84532"), "testnet");
  assert.equal(envOf("hedera:mainnet"), "mainnet");
  assert.equal(envOf("solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1"), "testnet");
  assert.equal(explorerUrl("eip155:8453", "0xabc"), "https://basescan.org/tx/0xabc");
  assert.equal(paymentHash({}), null);
  assert.equal(paymentHash({ payload: { transaction: "x" } }), paymentHash({ payload: { transaction: "x" } }));
  const s = computeStats([], 3);
  assert.equal(s.successRate, null);
  assert.equal(s.daily.length, 3);
});

test("mounts under a path, dashboard included", async () => {
  const { app } = await setup();
  const { Hono } = await import("hono");
  const host = new Hono().route("/api/x402/facilitator", app);
  assert.equal((await host.request("/api/x402/facilitator/supported")).status, 200);
  // Root-relative fetches would read the host's /stats, not this instance's.
  const html = await (await host.request("/api/x402/facilitator/dashboard")).text();
  assert.doesNotMatch(html, /fetch\("\//);
});
