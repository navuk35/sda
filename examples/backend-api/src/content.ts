/**
 * content.ts — Content endpoint (Hono + SurrealDB v2).
 */

import { Hono } from "hono";
import { getDb } from "./db.js";

interface ContentRow {
  uri: string;
  version: string;
  content: string;
}

export const contentRoute = new Hono();

contentRoute.get("/content/:uri", async (c) => {
  const uri = decodeURIComponent(c.req.param("uri"));
  const db = getDb();

  const [skillRows] = await db
    .query("SELECT uri, version, content FROM skill WHERE uri = $uri LIMIT 1", {
      uri,
    })
    .collect<[ContentRow[]]>();

  if (skillRows?.[0]) {
    return c.json(skillRows[0]);
  }

  const [resourceRows] = await db
    .query(
      "SELECT uri, version, content FROM resource WHERE uri = $uri LIMIT 1",
      { uri },
    )
    .collect<[ContentRow[]]>();

  if (resourceRows?.[0]) {
    return c.json(resourceRows[0]);
  }

  return c.json({ error: `Content not found: ${uri}` }, 404);
});
