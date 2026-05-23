/**
 * sda-backend.test.ts — Integration tests for SDA Backend API
 *
 * Uses Hono's app.request() — no HTTP server needed.
 * Connects to real SurrealDB via v2 SDK.
 *
 * Run: npx vitest run src/sda-backend.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Hono } from "hono";
import { Surreal, Table } from "surrealdb";
import { connectDb } from "./db.js";
import { createHash } from "node:crypto";
import { catalogRoute } from "./catalog.js";
import { contentRoute } from "./content.js";
import { authRoute, authMiddleware } from "./auth.js";

// ─── Setup ──────────────────────────────────────────────────

const SURREAL_URL = process.env.SURREAL_URL || "ws://localhost:8000/rpc";
const SURREAL_USER = process.env.SURREAL_USER || "root";
const SURREAL_PASS = process.env.SURREAL_PASS || "root";

const TEST_API_KEY = "sk_test_sda_integration_2026";

let db: Surreal;
let app: Hono;

beforeAll(async () => {
  db = await connectDb();

  // Subscription already seeded — verify it exists, create only if missing
  const keyHash = createHash("sha256").update(TEST_API_KEY).digest("hex");
  const [existingSubs] = await db
    .query("SELECT * FROM subscription WHERE key_hash = $hash LIMIT 1", { hash: keyHash })
    .collect<[{ id: string }[]]>();
  if (!existingSubs?.length) {
    await db.create(new Table("subscription")).content({
      customer_id: "test_customer",
      key_hash: keyHash,
      plan: "pro",
      agent_types: ["pricing-bot", "kyc-bot"],
      max_agents: 10,
      status: "active",
      created_at: new Date(),
      expires_at: new Date(Date.now() + 365 * 86400000),
    });
  }

  // Build Hono app
  app = new Hono();
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.route("/api/v1/auth", authRoute);
  app.use("/api/v1/catalog/*", authMiddleware);
  app.use("/api/v1/content/*", authMiddleware);
  app.route("/api/v1", catalogRoute);
  app.route("/api/v1", contentRoute);
});

afterAll(async () => {
  await db.close();
});

// ─── Helpers ────────────────────────────────────────────────

function authHeader() {
  return { Authorization: `Bearer ${TEST_API_KEY}` };
}

// ─── 1. Health Check ────────────────────────────────────────

describe("Health Check", () => {
  it("GET /health returns ok", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

// ─── 2. Authentication ──────────────────────────────────────

describe("Authentication", () => {
  it("valid API key returns valid:true", async () => {
    const res = await app.request("/api/v1/auth/validate", { headers: authHeader() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.valid).toBe(true);
    expect(body.plan).toBe("pro");
    expect(body.agentTypes).toContain("pricing-bot");
  });

  it("missing API key returns 401", async () => {
    const res = await app.request("/api/v1/auth/validate");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.valid).toBe(false);
    expect(body.error).toBe("Missing API key");
  });

  it("invalid API key returns 401", async () => {
    const res = await app.request("/api/v1/auth/validate", {
      headers: { Authorization: "Bearer invalid_key_xyz" },
    });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.valid).toBe(false);
  });

  it("malformed header (no Bearer prefix) returns 401", async () => {
    const res = await app.request("/api/v1/auth/validate", {
      headers: { Authorization: "Basic xyz" },
    });
    expect(res.status).toBe(401);
  });
});

// ─── 3. Catalog ─────────────────────────────────────────────

describe("Catalog", () => {
  it("valid key returns catalog for pricing-bot", async () => {
    const res = await app.request("/api/v1/catalog/pricing-bot", { headers: authHeader() });
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.agentType).toBe("pricing-bot");
    expect(body.version).toBe("1.0");
    expect(body.skills).toHaveLength(2);
    expect(body.resources).toHaveLength(3);
    expect(body.repos).toHaveLength(1);
    expect(body.repos[0].name).toBe("pricing-engine");
    expect(body.mcpServers).toHaveLength(1);
    expect(body.mcpServers[0].name).toBe("jira");
  });

  it("missing key returns 401", async () => {
    const res = await app.request("/api/v1/catalog/pricing-bot");
    expect(res.status).toBe(401);
  });

  it("unknown agent type returns 404", async () => {
    const res = await app.request("/api/v1/catalog/nonexistent-bot", { headers: authHeader() });
    expect(res.status).toBe(404);
  });
});

// ─── 4. Content ─────────────────────────────────────────────

describe("Content", () => {
  it("fetch skill content by URI", async () => {
    const uri = encodeURIComponent("skills://pricing-bot/debug-pricing");
    const res = await app.request(`/api/v1/content/${uri}`, { headers: authHeader() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.uri).toBe("skills://pricing-bot/debug-pricing");
    expect(body.content).toContain("How to Debug Pricing Issues");
    expect(body.content).toContain("NEVER modify pricing configs");
  });

  it("fetch resource content by URI", async () => {
    const uri = encodeURIComponent("docs://pricing/overview");
    const res = await app.request(`/api/v1/content/${uri}`, { headers: authHeader() });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.content).toContain("Pricing Engine Overview");
  });

  it("unknown URI returns 404", async () => {
    const uri = encodeURIComponent("skills://nonexistent/fake");
    const res = await app.request(`/api/v1/content/${uri}`, { headers: authHeader() });
    expect(res.status).toBe(404);
  });

  it("missing key returns 401", async () => {
    const uri = encodeURIComponent("skills://pricing-bot/debug-pricing");
    const res = await app.request(`/api/v1/content/${uri}`);
    expect(res.status).toBe(401);
  });
});

// ─── 5. Seed Data Integrity ─────────────────────────────────

describe("Seed Data Integrity", () => {
  it("pricing-bot has exactly 2 skills", async () => {
    const res = await app.request("/api/v1/catalog/pricing-bot", { headers: authHeader() });
    const body = await res.json();
    expect(body.skills).toHaveLength(2);
  });

  it("pricing-bot has exactly 3 resources", async () => {
    const res = await app.request("/api/v1/catalog/pricing-bot", { headers: authHeader() });
    const body = await res.json();
    expect(body.resources).toHaveLength(3);
  });

  it("debug-pricing skill contains safety instruction", async () => {
    const uri = encodeURIComponent("skills://pricing-bot/debug-pricing");
    const res = await app.request(`/api/v1/content/${uri}`, { headers: authHeader() });
    const body = await res.json();
    expect(body.content).toContain("NEVER modify pricing configs");
  });

  it("commission resource contains split percentages", async () => {
    const uri = encodeURIComponent("docs://pricing/commission");
    const res = await app.request(`/api/v1/content/${uri}`, { headers: authHeader() });
    const body = await res.json();
    expect(body.content).toContain("Super Agent 40%");
  });
});
