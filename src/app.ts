import { Hono } from "hono";
import { createFacilitatorApp } from "./facilitator/app.js";
import { createDemoApp } from "./demo/resource-server.js";
import { runDemoPurchase } from "./demo/agent.js";
import { renderDemoPage } from "./demo/ui.js";
import { SYMBOLS } from "./demo/quotes.js";

export function createApp() {
  const { app: facilitatorApp, network, accountId } = createFacilitatorApp();

  const app = new Hono();

  // Facilitator HTTP contract — must stay at these exact root paths so any
  // x402 resource server's HTTPFacilitatorClient can point straight at this
  // deployment with zero code changes.
  app.route("/", facilitatorApp);

  // Demo pay-per-call resource server, self-referentially pointed at this
  // same deployment's facilitator (see src/demo/resource-server.ts).
  app.all("/demo/api/*", (c) => {
    const origin = requestOrigin(c.req.raw);
    return createDemoApp(origin).fetch(c.req.raw);
  });

  app.post("/demo/run", async (c) => {
    const symbol = (c.req.query("symbol") || SYMBOLS[0]).toUpperCase();
    if (!SYMBOLS.includes(symbol)) {
      return c.json({ error: `Unknown symbol. Try one of: ${SYMBOLS.join(", ")}` }, 400);
    }
    const asset = c.req.query("asset") === "usdc" ? "usdc" : "hbar";
    try {
      const origin = requestOrigin(c.req.raw);
      const result = await runDemoPurchase(origin, symbol, asset);
      return c.json(result);
    } catch (err) {
      console.error("[demo] purchase failed:", err);
      return c.json({ error: err instanceof Error ? err.message : "Demo purchase failed" }, 500);
    }
  });

  app.get("/", (c) => c.html(renderDemoPage(accountId, network, Boolean(process.env.DEMO_USDC_TOKEN_ID))));

  return app;
}

function requestOrigin(req: Request): string {
  const url = new URL(req.url);
  const forwardedHost = req.headers.get("x-forwarded-host");
  const forwardedProto = req.headers.get("x-forwarded-proto");
  if (forwardedHost) return `${forwardedProto || url.protocol.replace(":", "")}://${forwardedHost}`;
  return url.origin;
}
