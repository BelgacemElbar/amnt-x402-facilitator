import "dotenv/config";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";

const port = Number(process.env.PORT || 3000);
const app = await createApp();

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`amnt-x402-facilitator listening on http://localhost:${info.port} (dashboard at /dashboard)`);
});
