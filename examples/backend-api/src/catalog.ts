/**
 * catalog.ts — Catalog endpoint (Hono + SurrealDB v2).
 */

import { Hono } from "hono";
import { getDb } from "./db.js";

interface CatalogRow {
  agent_type: string;
  version: string;
  repos?: { url: string; name?: string; branch?: string }[];
  mcp_servers?: { name: string; command: string; args?: string[] }[];
}

interface SkillRow {
  uri: string;
  version: string;
  hash: string;
}

interface ResourceRow {
  uri: string;
  version: string;
  hash: string;
}

export const catalogRoute = new Hono();

catalogRoute.get("/catalog/:agentType", async (c) => {
  const agentType = c.req.param("agentType");
  const db = getDb();

  const [catalogRows] = await db
    .query("SELECT * FROM catalog WHERE agent_type = $agent_type LIMIT 1", {
      agent_type: agentType,
    })
    .collect<[CatalogRow[]]>();

  const catalog = catalogRows?.[0];
  if (!catalog) {
    return c.json({ error: `Unknown agent type: ${agentType}` }, 404);
  }

  const [skillRows] = await db
    .query("SELECT uri, version, hash FROM skill WHERE agent_type = $agent_type", {
      agent_type: agentType,
    })
    .collect<[SkillRow[]]>();

  const [resourceRows] = await db
    .query(
      "SELECT uri, version, hash FROM resource WHERE agent_type = $agent_type",
      { agent_type: agentType },
    )
    .collect<[ResourceRow[]]>();

  return c.json({
    agentType,
    version: catalog.version,
    skills: skillRows || [],
    resources: resourceRows || [],
    repos: catalog.repos || [],
    mcpServers: catalog.mcp_servers || [],
  });
});
