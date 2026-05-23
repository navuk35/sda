/**
 * index.ts — SDA Backend API entry point (Hono).
 *
 * Routes:
 *   GET  /health
 *   GET  /api/v1/auth/validate
 *   GET  /api/v1/catalog/:agentType
 *   GET  /api/v1/content/:uri
 */

import { Hono } from "hono";
import { serve } from "@hono/node-server";
import { connectDb, seedData } from "./db.js";
import { setupLiveQueries } from "./notifications.js";
import { catalogRoute } from "./catalog.js";
import { contentRoute } from "./content.js";
import { authRoute, authMiddleware } from "./auth.js";

const app = new Hono();

// Health check (no auth required)
app.get("/health", (c) => c.json({ status: "ok" }));

// Auth route (no auth required)
app.route("/api/v1/auth", authRoute);

// Protected routes
app.use("/api/v1/catalog/*", authMiddleware);
app.use("/api/v1/content/*", authMiddleware);
app.route("/api/v1", catalogRoute);
app.route("/api/v1", contentRoute);

const PORT = parseInt(process.env.PORT || "3000", 10);

async function start() {
  await connectDb();
  await seedData();
  await setupLiveQueries();

  serve({ fetch: app.fetch, port: PORT }, (info) => {
    console.log(`SDA Backend API (Hono) running on http://localhost:${info.port}`);
  });
}

start().catch(console.error);
