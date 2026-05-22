import { Router, Request, Response } from "express";
import { getDb } from "./db.js";

const router = Router();

router.get("/catalog/:agentType", async (req: Request, res: Response) => {
  const { agentType } = req.params;
  const db = getDb();

  const catalogs = await db.query(
    "SELECT * FROM catalog WHERE agent_type = $agent_type LIMIT 1",
    { agent_type: agentType }
  );

  const catalog = catalogs[0]?.[0];
  if (!catalog) {
    res.status(404).json({ error: `Unknown agent type: ${agentType}` });
    return;
  }

  const skills = await db.query(
    "SELECT uri, version, hash FROM skill WHERE agent_type = $agent_type",
    { agent_type: agentType }
  );

  const resources = await db.query(
    "SELECT uri, version, hash FROM resource WHERE agent_type = $agent_type",
    { agent_type: agentType }
  );

  res.json({
    agentType,
    version: catalog.version,
    skills: skills[0] || [],
    resources: resources[0] || [],
    repos: catalog.repos || [],
    mcpServers: catalog.mcp_servers || [],
  });
});

export default router;
