/**
 * agent-runner.test.ts — Integration tests for SDA Agent Runner
 *
 * Tests boot sequence, session store, catalog client, and HTTP endpoints.
 * Uses DeepSeek V4 Flash for cheap LLM testing (~$0.00003 per query).
 *
 * Prerequisites: Backend API running on http://localhost:3000
 * Run: npx vitest run src/agent-runner.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { Surreal } from "surrealdb";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import {
  fetchCatalog,
  fetchContent,
} from "./catalog.js";
import { boot, type BootOptions } from "./boot.js";
import {
  SessionStore,
  type SessionStoreOptions,
} from "./session.js";
import { catalogRoute } from "../../backend-api/src/catalog.js";
import { contentRoute } from "../../backend-api/src/content.js";
import { authRoute, authMiddleware } from "../../backend-api/src/auth.js";
import { connectDb } from "../../backend-api/src/db.js";

// ─── Configuration ──────────────────────────────────────────

const TEST_PORT = 3099;
const BACKEND_URL = `http://localhost:${TEST_PORT}`;
const API_KEY = process.env.SDA_API_KEY || "sk_test_sda_integration_2026";
const AGENT_TYPE = "pricing-bot";
const WORKSPACE_DIR = `/tmp/sda-test-${randomUUID().slice(0, 8)}`;

const SURREAL_URL = "ws://localhost:8000/rpc";
const SURREAL_USER = "root";
const SURREAL_PASS = "root";

const sessionOpts: SessionStoreOptions = {
  surrealUrl: SURREAL_URL,
  surrealUser: SURREAL_USER,
  surrealPass: SURREAL_PASS,
  surrealNamespace: "sda",
  surrealDatabase: "agents",
};

let db: Surreal;
let backendServer: ReturnType<typeof serve>;

// ─── Setup / Teardown ───────────────────────────────────────

beforeAll(async () => {
  // Start backend API server on test port
  await connectDb(); // Init module-level db singleton

  const app = new Hono();
  app.get("/health", (c) => c.json({ status: "ok" }));
  app.route("/api/v1/auth", authRoute);
  app.use("/api/v1/catalog/*", authMiddleware);
  app.use("/api/v1/content/*", authMiddleware);
  app.route("/api/v1", catalogRoute);
  app.route("/api/v1", contentRoute);

  backendServer = serve({ fetch: app.fetch, port: TEST_PORT });
  await new Promise<void>((resolve) => backendServer.on("listening", resolve));

  // Connect to SurrealDB
  db = new Surreal();
  await db.connect(SURREAL_URL);
  await db.signin({ username: SURREAL_USER, password: SURREAL_PASS });
  await db.use({ namespace: "sda", database: "agents" });
});

afterAll(async () => {
  try { rmSync(WORKSPACE_DIR, { recursive: true, force: true }); } catch {}
  backendServer.close();
  await db.close();
});

// ─── 1. Catalog Client ──────────────────────────────────────

describe("Catalog Client", () => {
  it("fetchCatalog returns pricing-bot data", async () => {
    const catalog = await fetchCatalog(BACKEND_URL, AGENT_TYPE, API_KEY);

    expect(catalog.agentType).toBe(AGENT_TYPE);
    expect(catalog.version).toBe("1.0");
    expect(catalog.skills.length).toBe(2);
    expect(catalog.resources.length).toBe(3);
    expect(catalog.repos.length).toBe(1);
    expect(catalog.repos[0].name).toBe("pricing-engine");
  });

  it("fetchCatalog with invalid API key throws", async () => {
    await expect(
      fetchCatalog(BACKEND_URL, AGENT_TYPE, "invalid_key"),
    ).rejects.toThrow();
  });

  it("fetchCatalog with unknown agent type throws", async () => {
    await expect(
      fetchCatalog(BACKEND_URL, "nonexistent-bot", API_KEY),
    ).rejects.toThrow();
  });

  it("fetchContent returns skill content", async () => {
    const result = await fetchContent(
      BACKEND_URL,
      "skills://pricing-bot/debug-pricing",
      API_KEY,
    );

    expect(result.uri).toBe("skills://pricing-bot/debug-pricing");
    expect(result.version).toBe("1.0");
    expect(result.content).toContain("How to Debug Pricing Issues");
    expect(result.content).toContain("NEVER modify pricing configs");
  });

  it("fetchContent returns resource content", async () => {
    const result = await fetchContent(
      BACKEND_URL,
      "docs://pricing/overview",
      API_KEY,
    );

    expect(result.uri).toBe("docs://pricing/overview");
    expect(result.content).toContain("Pricing Engine Overview");
  });

  it("fetchContent with unknown URI throws", async () => {
    await expect(
      fetchContent(BACKEND_URL, "skills://nonexistent/fake", API_KEY),
    ).rejects.toThrow();
  });
});

// ─── 2. Boot Sequence ───────────────────────────────────────

describe("Boot Sequence", () => {
  let bootResult: Awaited<ReturnType<typeof boot>>;

  beforeAll(async () => {
    const opts: BootOptions = {
      backendUrl: BACKEND_URL,
      agentType: AGENT_TYPE,
      apiKey: API_KEY,
      workspaceDir: WORKSPACE_DIR,
    };
    bootResult = await boot(opts);
  });

  it("boot returns BootResult with correct structure", () => {
    expect(bootResult.catalog).toBeDefined();
    expect(bootResult.skillsDir).toContain(".pi/skills");
    expect(bootResult.resourcesDir).toContain("docs");
    expect(bootResult.reposDir).toContain("src");
    expect(bootResult.bootTimeMs).toBeGreaterThan(0);
    expect(bootResult.bootTimeMs).toBeLessThan(10_000); // < 10 seconds
  });

  it("skills are written to filesystem", () => {
    const debugPricing = join(bootResult.skillsDir, "debug-pricing.md");
    const analyzeIssues = join(bootResult.skillsDir, "analyze-issues.md");

    expect(existsSync(debugPricing)).toBe(true);
    expect(existsSync(analyzeIssues)).toBe(true);

    const content = readFileSync(debugPricing, "utf-8");
    expect(content).toContain("How to Debug Pricing Issues");
    expect(content).toContain("NEVER modify pricing configs");
  });

  it("resources are written to filesystem", () => {
    const overview = join(bootResult.resourcesDir, "pricing", "overview.md");
    const commission = join(bootResult.resourcesDir, "pricing", "commission.md");

    expect(existsSync(overview)).toBe(true);
    expect(existsSync(commission)).toBe(true);

    const content = readFileSync(commission, "utf-8");
    expect(content).toContain("Super Agent 40%");
  });

  it("boot with invalid API key throws", async () => {
    const badOpts: BootOptions = {
      backendUrl: BACKEND_URL,
      agentType: AGENT_TYPE,
      apiKey: "invalid_key",
      workspaceDir: `/tmp/sda-test-bad-${randomUUID().slice(0, 4)}`,
    };
    await expect(boot(badOpts)).rejects.toThrow();
  });

  it("boot creates .pi/skills directory not .claude/skills", () => {
    expect(bootResult.skillsDir).toContain(".pi/skills");
    expect(bootResult.skillsDir).not.toContain(".claude");
  });
});

// ─── 3. Session Store ───────────────────────────────────────

describe("Session Store", () => {
  let store: SessionStore;
  const testSessionId = `test-session-${randomUUID().slice(0, 8)}`;

  beforeAll(async () => {
    store = await SessionStore.connect(sessionOpts, testSessionId, AGENT_TYPE);
  });

  afterAll(async () => {
    await store.closeSession();
    // Clean up test data
    await db.query("DELETE FROM turn WHERE session_id = $id", {
      id: testSessionId,
    });
    await db.query("DELETE FROM session WHERE session_id = $id", {
      id: testSessionId,
    });
  });

  it("creates a session record in SurrealDB", async () => {
    expect(store.getSessionId()).toBe(testSessionId);

    const [rows] = await db
      .query<[Array<{ session_id: string; status: string }>]>(
        "SELECT * FROM session WHERE session_id = $id",
        { id: testSessionId },
      )
      .collect();

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("active");
  });

  it("records user turn", async () => {
    await store.recordTurn({
      role: "user",
      content: "What is the service charge policy?",
    });

    const [rows] = await db
      .query<[Array<{ role: string; sequence: number }>]>(
        "SELECT * FROM turn WHERE session_id = $id ORDER BY sequence ASC",
        { id: testSessionId },
      )
      .collect();

    expect(rows.length).toBeGreaterThanOrEqual(1);
    expect(rows[0].role).toBe("user");
    expect(rows[0].sequence).toBe(1);
  });

  it("records assistant turn with incremented sequence", async () => {
    await store.recordTurn({
      role: "assistant",
      content: "Service charge is a fee charged to end-users.",
      tokens_used: 150,
    });

    const [rows] = await db
      .query<[Array<{ role: string; sequence: number }>]>(
        "SELECT * FROM turn WHERE session_id = $id ORDER BY sequence ASC",
        { id: testSessionId },
      )
      .collect();

    expect(rows.length).toBe(2);
    expect(rows[1].role).toBe("assistant");
    expect(rows[1].sequence).toBe(2);
  });

  it("closeSession updates status to closed", async () => {
    // Create a fresh session just for this test
    const closeId = `test-close-${randomUUID().slice(0, 6)}`;
    const tempStore = await SessionStore.connect(sessionOpts, closeId, AGENT_TYPE);
    await tempStore.closeSession();

    const [rows] = await db
      .query<[Array<{ status: string }>]>(
        "SELECT status FROM session WHERE session_id = $id",
        { id: closeId },
      )
      .collect();

    expect(rows[0].status).toBe("closed");

    // Cleanup
    await db.query("DELETE FROM session WHERE session_id = $id", { id: closeId });
  });
});

// ─── 4. LLM Integration (needs DEEPSEEK_API_KEY env var) ──

describe("LLM Integration", () => {
  const hasKey = !!process.env.DEEPSEEK_API_KEY;
  const testOrSkip = hasKey ? it : it.skip;
  const AGENT_PORT = 3098;

  let agentProcess: ReturnType<typeof import("node:child_process").spawn> | null = null;

  beforeAll(async () => {
    if (!hasKey) return;

    // Spawn agent runner as subprocess with env vars
    const { spawn } = await import("node:child_process");
    agentProcess = spawn("npx", ["tsx", "src/index.ts"], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        AGENT_TYPE,
        BACKEND_URL,
        SDA_API_KEY: API_KEY,
        SURREAL_URL: "ws://localhost:8000/rpc",
        SURREAL_USER,
        SURREAL_PASS,
        PORT: String(AGENT_PORT),
        WORKSPACE_DIR: `${WORKSPACE_DIR}-agent`,
      },
      stdio: "pipe",
    });

    // Wait for agent to be ready (timeout 20s for boot + Pi SDK init)
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Agent startup timeout after 20s")),
        20000,
      );
      const onData = (data: Buffer) => {
        const text = data.toString();
        process.stderr.write(text); // Forward logs for debugging
        if (text.includes("Agent listening")) {
          clearTimeout(timeout);
          resolve();
        }
      };
      agentProcess!.stdout?.on("data", onData);
      agentProcess!.stderr?.on("data", onData);
      agentProcess!.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
      agentProcess!.on("exit", (code) => {
        if (code !== null && code !== 0) {
          clearTimeout(timeout);
          reject(new Error(`Agent exited with code ${code}`));
        }
      });
    });
  }, 25000);

  afterAll(() => {
    agentProcess?.kill();
  });

  testOrSkip("GET /health returns ready status", async () => {
    const res = await fetch(`http://localhost:${AGENT_PORT}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ready");
    expect(body.agentType).toBe(AGENT_TYPE);
    expect(body.skills.length).toBe(2);
    expect(body.resources.length).toBe(3);
  });

  testOrSkip(
    "POST /query uses domain knowledge from loaded skills",
    async () => {
      const res = await fetch(`http://localhost:${AGENT_PORT}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: "What is the service charge policy? Answer in one sentence.",
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.response).toBeTruthy();
      // Should reference domain knowledge from loaded resource
      const lower = body.response.toLowerCase();
      const hasKnowledge =
        lower.includes("flat") ||
        lower.includes("percentage") ||
        lower.includes("tiered") ||
        lower.includes("fee");
      expect(hasKnowledge).toBe(true);
    },
    30000,
  );

  testOrSkip(
    "POST /query uses skill instructions",
    async () => {
      const res = await fetch(`http://localhost:${AGENT_PORT}/query`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt:
            "How should I debug pricing issues? Mention the first step only.",
        }),
      });
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.response).toBeTruthy();
      // Should reference skill instructions about checking policies
      const lower = body.response.toLowerCase();
      const hasSkillRef =
        lower.includes("policy") ||
        lower.includes("check") ||
        lower.includes("active") ||
        lower.includes("transaction");
      expect(hasSkillRef).toBe(true);
    },
    30000,
  );
});
