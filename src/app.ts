import { Hono } from "hono";
import { x402Facilitator } from "@x402/core/facilitator";
import { registerChains, envOf, explorerUrl, type FeePayer } from "./chains/index.js";
import { openStore, type Row, type Store } from "./store.js";
import { computeStats, paymentHash } from "./stats.js";
import { dashboardHtml } from "./dashboard.js";

type Env = Record<string, string | undefined>;

/** The part of x402Facilitator this app uses - a fake one is enough for tests. */
export type FacilitatorLike = Pick<x402Facilitator, "verify" | "settle" | "getSupported">;

/** Real chains, real store, from environment variables. */
export async function createApp(env: Env = process.env) {
  const facilitator = new x402Facilitator().registerExtension({ key: "bazaar" } as any);
  const feePayers = await registerChains(facilitator, env);
  const store = await openStore(env);
  return createFacilitatorApp({ facilitator, feePayers, store, env });
}

/**
 * The HTTP API. Same wire format as Coinbase's facilitator, so any x402
 * resource server can point at this by changing one URL:
 *
 *   POST /verify   POST /settle   GET /supported
 * plus
 *   GET /health   GET /stats   GET /transactions   GET /discovery/resources   GET /dashboard
 */
export function createFacilitatorApp({ facilitator, feePayers, store, env = {} }: { facilitator: FacilitatorLike; feePayers: FeePayer[]; store: Store; env?: Env }) {
  const app = new Hono();
  const minAmount = BigInt(env.MIN_AMOUNT_ATOMIC || "0");
  const allow = (env.PAY_TO_ALLOWLIST || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
  const perMinute = Number(env.RATE_LIMIT_PER_MINUTE ?? 120);
  // ponytail: in-memory per process; a multi-instance deploy limits per instance. Move to the store if abused.
  const hits = new Map<string, number[]>();

  const log = async (kind: Row["kind"], status: Row["status"], payload: any, req: any, extra: Partial<Row>) => {
    try {
      await store.insert({
        env: envOf(req?.network), network: String(req?.network || "unknown").slice(0, 80), scheme: String(req?.scheme || "exact").slice(0, 40),
        kind, status, payer: null, pay_to: req?.payTo ? String(req.payTo).slice(0, 120) : null, asset: req?.asset ? String(req.asset).slice(0, 120) : null,
        amount_atomic: /^\d+$/.test(String(req?.amount ?? "")) ? String(req.amount) : null,
        resource_url: typeof payload?.resource?.url === "string" ? payload.resource.url.slice(0, 2048) : null,
        tx_id: null, payment_hash: paymentHash(payload), error_reason: null, error_message: null,
        fee_payer: req?.extra?.feePayer ?? null, total_ms: null, created_at: new Date().toISOString(),
        ...extra,
      });
    } catch (err: any) {
      // A log write must never turn a settled payment into an error the buyer sees.
      console.error("[facilitator] log write failed:", err?.message || err);
    }
  };

  /** Checks every payment must pass before a chain sees it. Null means go ahead. */
  const guard = async (payload: any, req: any, settling: boolean): Promise<{ reason: string; message: string } | null> => {
    const hash = paymentHash(payload);
    const already = hash ? await store.settledTx(hash) : null;
    // A settled payment still has a valid signature. Without this, an old
    // payload handed to a resource server would verify and be served again for free.
    if (already) return { reason: "already_settled", message: `This payment already settled in ${already}.` };
    if (minAmount > 0n && /^\d+$/.test(String(req.amount)) && BigInt(req.amount) < minAmount) {
      return { reason: "amount_below_minimum", message: `This facilitator settles ${minAmount} atomic units or more.` };
    }
    if (allow.length && !allow.includes(String(req.payTo || "").toLowerCase())) {
      return { reason: "pay_to_not_allowed", message: "This facilitator only settles for its own servers." };
    }
    if (settling && perMinute > 0) {
      const key = String(req.payTo || "");
      const now = Date.now();
      const recent = (hits.get(key) || []).filter((t) => now - t < 60_000);
      if (recent.length >= perMinute) return { reason: "rate_limited", message: `More than ${perMinute} settlements a minute for this payee. Try again shortly.` };
      recent.push(now);
      hits.set(key, recent);
    }
    return null;
  };

  app.get("/", (c) =>
    c.json({
      name: "amnt-x402-facilitator",
      networks: facilitator.getSupported().kinds.map((k) => k.network),
      endpoints: ["POST /verify", "POST /settle", "GET /supported", "GET /health", "GET /stats", "GET /transactions", "GET /discovery/resources", "GET /dashboard"],
      source: "https://github.com/BelgacemElbar/amnt-x402-facilitator",
    }),
  );

  app.post("/verify", async (c) => {
    const body = await readBody(c.req.raw);
    if ("error" in body) return c.json(body.error, 400);
    const { paymentPayload, paymentRequirements } = body;
    const started = Date.now();
    const refused = await guard(paymentPayload, paymentRequirements, false);
    if (refused) {
      await log("verify", "rejected", paymentPayload, paymentRequirements, { error_reason: refused.reason, total_ms: Date.now() - started });
      return c.json({ isValid: false, invalidReason: refused.reason, invalidMessage: refused.message, payer: "" });
    }
    let result: any;
    try {
      result = await facilitator.verify(paymentPayload, paymentRequirements);
    } catch (err: any) {
      return c.json({ isValid: false, invalidReason: "invalid_payload", invalidMessage: String(err?.message || err).slice(0, 300) }, 400);
    }
    if (!result.isValid) {
      await log("verify", "rejected", paymentPayload, paymentRequirements, {
        payer: result.payer || null, error_reason: result.invalidReason ?? null, error_message: result.invalidMessage?.slice(0, 500) ?? null, total_ms: Date.now() - started,
      });
    }
    return c.json(result);
  });

  app.post("/settle", async (c) => {
    const body = await readBody(c.req.raw);
    if ("error" in body) return c.json(body.error, 400);
    const { paymentPayload, paymentRequirements } = body;
    const started = Date.now();
    const refused = await guard(paymentPayload, paymentRequirements, true);
    if (refused) {
      await log("settle", "rejected", paymentPayload, paymentRequirements, { error_reason: refused.reason, total_ms: Date.now() - started });
      const tx = refused.reason === "already_settled" ? refused.message.match(/in (\S+)\.$/)?.[1] ?? "" : "";
      return c.json({ success: false, errorReason: refused.reason, errorMessage: refused.message, transaction: tx, network: paymentRequirements.network ?? "", payer: "" });
    }
    let result: any;
    try {
      result = await facilitator.settle(paymentPayload, paymentRequirements);
    } catch (err: any) {
      return c.json({ success: false, errorReason: "invalid_payload", errorMessage: String(err?.message || err).slice(0, 300), transaction: "", network: paymentRequirements.network ?? "" }, 400);
    }
    await log("settle", result?.success ? "settled" : "failed", paymentPayload, paymentRequirements, {
      payer: result?.payer || null, tx_id: result?.transaction || null,
      error_reason: result?.errorReason ?? null, error_message: result?.errorMessage?.slice(0, 500) ?? null, total_ms: Date.now() - started,
    });
    // Catalogue only resources that ask to be discovered, the same rule as Coinbase's Bazaar.
    const url = paymentPayload?.resource?.url;
    const bazaar = paymentPayload?.extensions?.bazaar;
    if (result?.success && bazaar && typeof url === "string" && url.startsWith("https://") && envOf(paymentRequirements.network) === "mainnet") {
      const r = paymentPayload.resource;
      await store
        .upsertResource(url, [paymentRequirements], { description: r.description, mimeType: r.mimeType, serviceName: r.serviceName, iconUrl: r.iconUrl, tags: r.tags, bazaar })
        .catch((err) => console.error("[facilitator] discovery write failed:", err?.message || err));
    }
    return c.json(result);
  });

  app.get("/supported", (c) => c.json(facilitator.getSupported()));

  /** Up, and every fee payer can still pay. 503 when one is low. */
  app.get("/health", async (c) => {
    const chains = await Promise.all(
      feePayers.map(async (p) => {
        const balance = await p.balance();
        return { network: p.network, feePayer: p.address, balance, unit: p.unit, lowBalance: balance !== null && balance < p.lowAt };
      }),
    );
    const low = chains.some((ch) => ch.lowBalance);
    return c.json({ status: low ? "degraded" : "ok", chains, time: new Date().toISOString() }, low ? 503 : 200);
  });

  app.get("/stats", async (c) => {
    const env = c.req.query("env") === "testnet" ? "testnet" : c.req.query("env") === "mainnet" ? "mainnet" : defaultEnv(feePayers);
    const days = Math.min(Math.max(Number(c.req.query("days")) || 14, 1), 365);
    const since = new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
    const rows = await store.settles(env, c.req.query("network") || null, since);
    c.header("cache-control", "public, max-age=30");
    return c.json({ env, days, networks: facilitator.getSupported().kinds.map((k) => k.network), ...computeStats(rows, days) });
  });

  app.get("/transactions", async (c) => {
    const env = c.req.query("env") === "testnet" ? "testnet" : c.req.query("env") === "mainnet" ? "mainnet" : defaultEnv(feePayers);
    const limit = Math.min(Math.max(Number(c.req.query("limit")) || 25, 1), 100);
    const status = c.req.query("status");
    const cursor = c.req.query("cursor");
    const rows = await store.transactions({
      env, limit, network: c.req.query("network") || undefined,
      status: status === "settled" || status === "failed" || status === "rejected" ? status : undefined,
      before: cursor && !Number.isNaN(Date.parse(cursor)) ? cursor : undefined,
    });
    c.header("cache-control", "public, max-age=15");
    return c.json({
      env,
      transactions: rows.map(({ payment_hash, error_message, ...r }) => ({ ...r, explorer: explorerUrl(r.network, r.tx_id) })),
      cursor: rows.length === limit ? rows[rows.length - 1].created_at : null,
    });
  });

  app.get("/discovery/resources", async (c) => {
    const limit = Math.min(Math.max(Number(c.req.query("limit")) || 100, 1), 500);
    const offset = Math.max(Number(c.req.query("offset")) || 0, 0);
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const { items, total } = await store.resources(since, limit, offset);
    c.header("cache-control", "public, max-age=60");
    return c.json({
      x402Version: 2,
      items: items.map((r: any) => ({
        resource: r.resource, type: "http", x402Version: 2, accepts: r.accepts, lastUpdated: r.last_updated,
        description: r.metadata?.description, mimeType: r.metadata?.mimeType, metadata: r.metadata,
        extensions: r.metadata?.bazaar ? { bazaar: r.metadata.bazaar } : undefined,
      })),
      pagination: { limit, offset, total },
    });
  });

  app.get("/dashboard", (c) => c.html(dashboardHtml));

  return app;
}

const defaultEnv = (payers: FeePayer[]) => (payers.some((p) => envOf(p.network) === "mainnet") ? "mainnet" : "testnet");

/**
 * Read and check a /verify or /settle body before a chain sees it.
 * Malformed input used to throw inside the scheme and come back as a bare 500,
 * which tells the caller to retry something that can never work and hides
 * which field was wrong.
 */
export async function readBody(req: Request): Promise<{ paymentPayload: any; paymentRequirements: any } | { error: { error: string; message: string } }> {
  const bad = (message: string) => ({ error: { error: "Bad Request", message } });
  let parsed: any;
  try {
    parsed = await req.json();
  } catch {
    return bad("Body must be JSON.");
  }
  if (!parsed || typeof parsed !== "object") return bad("Body must be a JSON object.");
  const { paymentPayload, paymentRequirements } = parsed;
  if (!paymentPayload || typeof paymentPayload !== "object") return bad("paymentPayload is required.");
  if (!paymentRequirements || typeof paymentRequirements !== "object") return bad("paymentRequirements is required.");
  if (paymentPayload.x402Version === undefined) return bad("paymentPayload.x402Version is required.");
  return { paymentPayload, paymentRequirements };
}
