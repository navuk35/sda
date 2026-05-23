/**
 * index.ts — SDA Backend API (Hono + sandcaster-compatible session API)
 */

import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { serve } from "@hono/node-server";
import { existsSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { connectDb, seedData, getDb } from "./db.js";
import { setupLiveQueries } from "./notifications.js";
import { contentRoute } from "./content.js";
import { catalogRoute } from "./catalog.js";
import { authRoute, authMiddleware } from "./auth.js";

const app = new Hono();
const PORT = parseInt(process.env.PORT || "3000", 10);

const SBX_BASE = "/tmp/sda-sandboxes";
const sessions = new Map<string, { workspaceDir: string; agentType: string }>();

// ─── Routes ──────────────────────────────────────────────────

app.get("/health", (c) => c.json({ status: "ok" }));
app.route("/api/v1/auth", authRoute);
app.use("/api/v1/catalog/*", authMiddleware);
app.use("/api/v1/content/*", authMiddleware);
app.route("/api/v1", catalogRoute);
app.route("/api/v1", contentRoute);

// ─── Session API (sandcaster-compatible) ─────────────────────

app.post("/sessions", async (c) => {
  try {
    const body = await c.req.json();
    const sessionId = `sda_${Date.now()}`;
    const agentType = body.agentType || "pricing-bot";

    // Create workspace
    const workspaceDir = join(SBX_BASE, sessionId);
    mkdirSync(workspaceDir, { recursive: true });
    mkdirSync(join(workspaceDir, ".pi", "skills"), { recursive: true });
    mkdirSync(join(workspaceDir, "docs"), { recursive: true });

    // Fetch skills + resources and mount
    const db = getDb();
    const [skills] = await db
      .query("SELECT uri, content FROM skill WHERE agent_type = $type", { type: agentType })
      .collect<[Array<{ uri: string; content: string }>]>();
    const [resources] = await db
      .query("SELECT uri, content FROM resource WHERE agent_type = $type", { type: agentType })
      .collect<[Array<{ uri: string; content: string }>]>();

    for (const s of skills || []) {
      const name = s.uri.split("/").pop() || "skill";
      const dir = join(workspaceDir, ".pi", "skills", name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "SKILL.md"), s.content);
    }
    for (const r of resources || []) {
      const p = join(workspaceDir, "docs", r.uri.replace("docs://", "") + ".md");
      const d = join(p, "..");
      if (!existsSync(d)) mkdirSync(d, { recursive: true });
      writeFileSync(p, r.content);
    }

    sessions.set(sessionId, { workspaceDir, agentType });

    // Persist to SurrealDB
    await db.query(
      "CREATE session CONTENT { session_id: $id, agent_type: $type, status: 'active', created_at: time::now(), updated_at: time::now() }",
      { id: sessionId, type: agentType },
    );

    return c.json({
      sessionId,
      status: "active",
      agentType,
      skillsCount: skills?.length || 0,
      resourcesCount: resources?.length || 0,
      workspaceDir,
      createdAt: new Date().toISOString(),
    }, 201);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 500);
  }
});

app.get("/sessions", async (c) => {
  const db = getDb();
  const [rows] = await db
    .query("SELECT session_id, agent_type, status, created_at FROM session WHERE status = 'active' ORDER BY created_at DESC")
    .collect<[Array<{ session_id: string; agent_type: string; status: string; created_at: Date }>]>();

  const list = (rows || []).map((r) => ({
    id: r.session_id,
    status: r.status,
    agentType: r.agent_type,
    runsCount: 0,
    totalCostUsd: 0,
    createdAt: r.created_at,
  }));
  return c.json(list);
});

app.post("/sessions/:id/messages", async (c) => {
  const sessionId = c.req.param("id");
  const sb = sessions.get(sessionId);
  if (!sb) return c.json({ error: "Session not found" }, 404);

  const body = await c.req.json();
  const prompt = (body as { prompt?: string }).prompt;
  if (!prompt) return c.json({ error: "Missing prompt" }, 400);

  // Stream back a placeholder for now — agent runner integration next
  return streamSSE(c, async (stream) => {
    await stream.writeSSE({
      event: "system",
      data: JSON.stringify({
        type: "system",
        subtype: "info",
        content: `Session ${sessionId}: skills mounted at ${sb.workspaceDir}/.pi/skills/`,
      }),
    });
    await stream.writeSSE({
      event: "result",
      data: JSON.stringify({
        type: "result",
        content: `[SDA] Skills mounted. Workspace: ${sb.workspaceDir}. Prompt: "${prompt.slice(0, 100)}"`,
      }),
    });
    await stream.writeSSE({ event: "done", data: "[DONE]" });
  });
});

app.delete("/sessions/:id", async (c) => {
  const sessionId = c.req.param("id");
  const sb = sessions.get(sessionId);
  if (!sb) return c.json({ error: "Not found" }, 404);

  try { rmSync(sb.workspaceDir, { recursive: true, force: true }); } catch {}
  sessions.delete(sessionId);

  const db = getDb();
  await db.query(
    "UPDATE session SET status = 'closed', updated_at = time::now() WHERE session_id = $id",
    { id: sessionId },
  );
  return c.json({ status: "deleted" });
});

// GET /sessions/:id/events — SSE stream for CLI attach
app.get("/sessions/:id/events", async (c) => {
  const sessionId = c.req.param("id");
  const sb = sessions.get(sessionId);
  if (!sb) return c.json({ error: "Not found" }, 404);

  return streamSSE(c, async (stream) => {
    await stream.writeSSE({
      event: "system",
      data: JSON.stringify({
        type: "system",
        subtype: "info",
        content: `Attached to session ${sessionId}`,
      }),
    });
    // Keep connection alive
    await new Promise(() => {});
  });
});

// ─── Start ───────────────────────────────────────────────────

async function start() {
  await connectDb();
  await seedData();
  await setupLiveQueries();

  serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`SDA Backend running on http://localhost:${info.port}`);
    console.log(`  POST /sessions              — create session`);
    console.log(`  GET  /sessions              — list sessions`);
    console.log(`  POST /sessions/:id/messages — query agent (SSE)`);
    console.log(`  DELETE /sessions/:id         — destroy session`);
  });
}

start().catch(console.error);
