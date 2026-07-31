import { Hono } from "hono";
import { paymentMiddleware } from "@x402/hono";
import { x402ResourceServer, HTTPFacilitatorClient } from "@x402/core/server";
import type { RoutesConfig } from "@x402/core/server";
import type { Network } from "@x402/core/types";
import { ExactHederaScheme } from "@x402/hedera/exact/server";
import { HBAR_ASSET_ID } from "@x402/hedera";
import { getQuote, SYMBOLS } from "./quotes.js";

// The demo "resource server": a pay-per-call market-data API. It never
// verifies or settles payments itself — it hands the signed payment to
// whatever facilitator its HTTPFacilitatorClient points at. Here that's
// this very deployment's own /verify + /settle (a real HTTP hop, not an
// in-process shortcut), proving the facilitator's contract works for any
// x402 resource server, including this one.
//
// One instance per Hono app (constructed once, memoized by origin) since
// x402ResourceServer.initialize() calls the facilitator's /supported on
// first use — no need to repeat that on every request.

let cached: { origin: string; app: Hono } | null = null;

export function createDemoApp(origin: string): Hono {
  if (cached && cached.origin === origin) return cached.app;

  const network = (process.env.HEDERA_FACILITATOR_NETWORK || "hedera:testnet") as Network;
  const payTo = process.env.DEMO_MERCHANT_ID;
  const priceTinybars = process.env.DEMO_PRICE_TINYBARS || "1000000"; // 0.01 HBAR
  const usdcTokenId = process.env.DEMO_USDC_TOKEN_ID;
  const usdcPrice = process.env.DEMO_USDC_PRICE || "10000"; // 0.01 tUSDC (6 decimals)

  if (!payTo) throw new Error("Missing DEMO_MERCHANT_ID");

  const server = new x402ResourceServer(new HTTPFacilitatorClient({ url: origin })).register(
    network,
    new ExactHederaScheme(),
  );

  const routes: RoutesConfig = {
    "GET /demo/api/quote/:symbol": {
      description: "Live-ish spot price for BTC, ETH, or HBAR — one x402 payment per call",
      accepts: {
        scheme: "exact",
        network,
        payTo,
        price: { asset: HBAR_ASSET_ID, amount: priceTinybars },
        maxTimeoutSeconds: 60,
      },
    },
  };

  if (usdcTokenId) {
    routes["GET /demo/api/quote-usdc/:symbol"] = {
      description: "Same quote, paid in a demo HTS stablecoin (tUSDC, 6 decimals) instead of HBAR",
      accepts: {
        scheme: "exact",
        network,
        payTo,
        price: { asset: usdcTokenId, amount: usdcPrice },
        maxTimeoutSeconds: 60,
      },
    };
  }

  const app = new Hono();

  app.use("/demo/api/quote/:symbol", async (c, next) => {
    const symbol = c.req.param("symbol")?.toUpperCase();
    if (!symbol || !SYMBOLS.includes(symbol)) {
      return c.json({ error: `Unknown symbol. Try one of: ${SYMBOLS.join(", ")}` }, 404);
    }
    await next();
  });
  app.use("/demo/api/quote-usdc/:symbol", async (c, next) => {
    const symbol = c.req.param("symbol")?.toUpperCase();
    if (!symbol || !SYMBOLS.includes(symbol)) {
      return c.json({ error: `Unknown symbol. Try one of: ${SYMBOLS.join(", ")}` }, 404);
    }
    await next();
  });

  app.use("*", paymentMiddleware(routes, server));

  app.get("/demo/api/quote/:symbol", (c) => c.json(getQuote(c.req.param("symbol"))));
  app.get("/demo/api/quote-usdc/:symbol", (c) => c.json(getQuote(c.req.param("symbol"))));

  cached = { origin, app };
  return app;
}
