import { createApp } from "../src/app.js";

export const config = { runtime: "nodejs" };

// Built once per instance. A failed build is not cached, so fixing an env var
// takes effect on the next request instead of whenever the instance recycles.
let appPromise: ReturnType<typeof createApp> | null = null;

async function handler(req: Request) {
  appPromise ??= createApp().catch((err) => {
    appPromise = null;
    throw err;
  });
  try {
    return (await appPromise).fetch(req);
  } catch (err: any) {
    // Answer, never throw: an empty 500 from /supported makes x402 resource
    // servers refuse to start at all.
    return Response.json({ error: "Facilitator unavailable", message: err?.message || "Not configured." }, { status: 503 });
  }
}

export const GET = handler;
export const POST = handler;
