/**
 * index.ts — SDA Agent Runner entry point.
 *
 * Pi SDK powers the agent runtime.
 * The boot sequence fetches domain identity from the backend.
 * SurrealDB LIVE queries enable hot reload of skills/resources.
 *
 * env vars:
 *   AGENT_TYPE         — "pricing-bot" | "kyc-bot" | etc.
 *   BACKEND_URL        — SDA backend API
 *   SDA_API_KEY        — Decrypted API key (plaintext in memory only)
 *   SURREAL_URL        — SurrealDB RPC endpoint
 *   SURREAL_USER       — SurrealDB username
 *   SURREAL_PASS       — SurrealDB password
 *   PORT               — Health check / query port (default 3001)
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { boot, type BootResult } from "./boot.js";
import { subscribeToLiveQueries, type SyncOptions } from "./sync.js";
import { SessionStore } from "./session.js";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
} from "@mariozechner/pi-coding-agent";
import { getModel } from "@mariozechner/pi-ai";

// ─── Configuration ─────────────────────────────────────────

const AGENT_TYPE = process.env.AGENT_TYPE || "pricing-bot";
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3000";
const API_KEY = process.env.SDA_API_KEY || "";
const SURREAL_URL = process.env.SURREAL_URL || "ws://localhost:8000/rpc";
const SURREAL_USER = process.env.SURREAL_USER || "root";
const SURREAL_PASS = process.env.SURREAL_PASS || "root";
const SURREAL_NS = process.env.SURREAL_NS || "sda";
const SURREAL_DB = process.env.SURREAL_DB || "agents";
const PORT = parseInt(process.env.PORT || "3001", 10);
const WORKSPACE_DIR = process.env.WORKSPACE_DIR || "/tmp/sda-agent";

// ─── State ──────────────────────────────────────────────────

let sessionStore: SessionStore;
let bootResult: BootResult;
let surrealDb: Awaited<ReturnType<typeof subscribeToLiveQueries>>;

// ─── Main ───────────────────────────────────────────────────

async function main() {
  if (!API_KEY) {
    console.error("[SDA] SDA_API_KEY is required");
    process.exit(1);
  }

  // ── Step 1-4: Boot — fetch catalog, write skills/resources, clone repos
  bootResult = await boot({
    backendUrl: BACKEND_URL,
    agentType: AGENT_TYPE,
    apiKey: API_KEY,
    workspaceDir: WORKSPACE_DIR,
  });

  // ── Step 5: Connect SurrealDB LIVE queries for hot reload
  const syncOpts: SyncOptions = {
    backendUrl: BACKEND_URL,
    apiKey: API_KEY,
    agentType: AGENT_TYPE,
    surrealUrl: SURREAL_URL,
    surrealUser: SURREAL_USER,
    surrealPass: SURREAL_PASS,
    surrealNamespace: SURREAL_NS,
    surrealDatabase: SURREAL_DB,
    skillsDir: bootResult.skillsDir,
    resourcesDir: bootResult.resourcesDir,
  };
  surrealDb = await subscribeToLiveQueries(syncOpts);

  // ── Step 6: Connect session store
  const sessionId = `sda_${AGENT_TYPE}_${Date.now()}`;
  sessionStore = await SessionStore.connect(
    {
      surrealUrl: SURREAL_URL,
      surrealUser: SURREAL_USER,
      surrealPass: SURREAL_PASS,
      surrealNamespace: SURREAL_NS,
      surrealDatabase: SURREAL_DB,
    },
    sessionId,
    AGENT_TYPE,
  );

  // ── Step 7: Create Pi agent session with SDK
  console.log(`[SDA] Creating agent session with Pi SDK...`);

  // Resource loader — discovers skills from .pi/skills/ and docs/
  const resourceLoader = new DefaultResourceLoader({
    cwd: WORKSPACE_DIR,
    agentDir: `${WORKSPACE_DIR}/.pi-agent`,
    systemPromptOverride: () => buildSystemPrompt(AGENT_TYPE),
  });
  await resourceLoader.reload();

  const skills = resourceLoader.getSkills();
  const extensions = resourceLoader.getExtensions();
  console.log(
    `[SDA] Loaded: ${Array.isArray(skills) ? skills.length : skills.skills.length} skills, ${extensions.extensions.length} extensions`,
  );

  // Resolve model — DeepSeek V4 Flash for cost efficiency ($0.14/$0.28 per M tokens)
  const model = getModel("deepseek", "deepseek-v4-flash") || undefined;

  // Create session
  const { session } = await createAgentSession({
    cwd: WORKSPACE_DIR,
    model,
    thinkingLevel: "high",
    sessionManager: SessionManager.inMemory(), // Stateless — sessions live in SurrealDB
    settingsManager: SettingsManager.create(WORKSPACE_DIR),
    resourceLoader,
  });

  console.log(`[SDA] Agent session ready\n`);

  // ── Step 8: Health check + query server
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    res.setHeader("Content-Type", "application/json");

    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200);
      res.end(
        JSON.stringify({
          status: "ready",
          agentType: AGENT_TYPE,
          skills: bootResult.catalog.skills.map((s) => `${s.uri}@${s.version}`),
          resources: bootResult.catalog.resources.map((r) => `${r.uri}@${r.version}`),
          bootTime: `${(bootResult.bootTimeMs / 1000).toFixed(1)}s`,
        }),
      );
      return;
    }

    if (req.url === "/query" && req.method === "POST") {
      try {
        const body = await readBody(req);
        const { prompt } = JSON.parse(body);

        if (!prompt) {
          res.writeHead(400);
          res.end(JSON.stringify({ error: "Missing 'prompt' field" }));
          return;
        }

        // Stream session turn to SurrealDB
        await sessionStore.recordTurn({
          role: "user",
          content: prompt,
        });

        // Collect response
        let responseText = "";
        const unsubscribe = session.subscribe((event) => {
          if (
            event.type === "message_update" &&
            event.assistantMessageEvent?.type === "text_delta"
          ) {
            responseText += event.assistantMessageEvent.delta;
          }
        });

        // Send prompt to agent
        await session.prompt(prompt);
        unsubscribe();

        // Record assistant response
        await sessionStore.recordTurn({
          role: "assistant",
          content: responseText,
          tokens_used: 0,
        });

        res.writeHead(200);
        res.end(JSON.stringify({ response: responseText }));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        res.writeHead(500);
        res.end(JSON.stringify({ error: message }));
      }
      return;
    }

    res.writeHead(404);
    res.end(JSON.stringify({ error: "Not found" }));
  });

  server.listen(PORT, () => {
    console.log(`[SDA] Agent listening on http://localhost:${PORT}`);
    console.log(`[SDA] Health: http://localhost:${PORT}/health`);
    console.log(`[SDA] Query: POST http://localhost:${PORT}/query`);
  });

  // ── Graceful shutdown
  process.on("SIGTERM", async () => {
    console.log(`\n[SDA] Shutting down...`);
    await sessionStore.closeSession();
    await surrealDb.close();
    server.close();
    process.exit(0);
  });
}

// ─── Helpers ────────────────────────────────────────────────

function buildSystemPrompt(agentType: string): string {
  return `You are an AI agent specialized in ${agentType.replace(/-/g, " ")}.

Your knowledge, skills, and codebase are loaded from the backend.
Use the read tool to explore docs/ for domain knowledge.
Use grep and read to search .pi/skills/ for behavioral instructions.
Use bash to interact with the codebase in src/.

Be thorough. Cite sources from docs/ when answering domain questions.
When debugging, follow the skill instructions in .pi/skills/.
Never modify production configs without explicit user approval.`;
}

function readBody(req: { on(event: string, cb: (...args: any[]) => void): void }): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

// ─── Start ──────────────────────────────────────────────────

main().catch((err) => {
  console.error("[SDA] Fatal error:", err);
  process.exit(1);
});
