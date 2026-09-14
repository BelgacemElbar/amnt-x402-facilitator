#!/usr/bin/env node
// `npx github:BelgacemElbar/amnt-x402-facilitator` - runs the TypeScript source directly.
import { register } from "tsx/esm/api";

register();
await import("../src/server.ts");
