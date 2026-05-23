/**
 * auth.ts — API key authentication middleware (Hono + SurrealDB v2).
 */

import { Hono } from "hono";
import type { Context, Next } from "hono";
import { createHash } from "node:crypto";
import { getDb } from "./db.js";

interface Subscription {
  id: string;
  customer_id: string;
  key_hash: string;
  plan: string;
  agent_types: string[];
  max_agents: number;
  status: string;
}

export const authRoute = new Hono();

authRoute.get("/validate", async (c) => {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ valid: false, error: "Missing API key" }, 401);
  }

  const apiKey = authHeader.slice(7);
  const keyHash = createHash("sha256").update(apiKey).digest("hex");

  const db = getDb();
  const [rows] = await db
    .query(
      "SELECT * FROM subscription WHERE key_hash = $hash AND status = 'active' LIMIT 1",
      { hash: keyHash },
    )
    .collect<[Subscription[]]>();

  const sub = rows?.[0];
  if (!sub) {
    return c.json({ valid: false, error: "Invalid or expired API key" }, 401);
  }

  return c.json({
    valid: true,
    plan: sub.plan,
    agentTypes: sub.agent_types,
  });
});

/**
 * Middleware that validates API key on every protected request.
 */
export async function authMiddleware(c: Context, next: Next) {
  const authHeader = c.req.header("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return c.json({ error: "Missing API key" }, 401);
  }

  const apiKey = authHeader.slice(7);
  const keyHash = createHash("sha256").update(apiKey).digest("hex");

  const db = getDb();
  const [rows] = await db
    .query(
      "SELECT * FROM subscription WHERE key_hash = $hash AND status = 'active' LIMIT 1",
      { hash: keyHash },
    )
    .collect<[Subscription[]]>();

  const sub = rows?.[0];
  if (!sub) {
    return c.json({ error: "Invalid or expired API key" }, 401);
  }

  c.set("subscription", sub);
  await next();
}
