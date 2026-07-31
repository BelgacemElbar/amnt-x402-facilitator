import "dotenv/config";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const PORT = Number(process.env.PORT || 4021);

const app = createApp();

serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`hedera-x402-facilitator listening on http://localhost:${info.port}`);
});
