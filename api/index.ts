import "dotenv/config";
import { createApp } from "../src/app.js";

export const config = { runtime: "nodejs" };

const app = createApp();

// Vercel's Node runtime now expects a Web-standard fetch handler per HTTP
// method rather than the legacy (req, res) => void signature that
// hono/vercel's handle() wraps — app.fetch already has that exact shape.
export const GET = app.fetch;
export const POST = app.fetch;
export const PUT = app.fetch;
export const PATCH = app.fetch;
export const DELETE = app.fetch;
export const HEAD = app.fetch;
export const OPTIONS = app.fetch;
