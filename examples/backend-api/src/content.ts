import { Router, Request, Response } from "express";
import { getDb } from "./db.js";

const router = Router();

router.get("/content/:uri", async (req: Request, res: Response) => {
  const uri = decodeURIComponent(req.params.uri);
  const db = getDb();

  const skills = await db.query(
    "SELECT uri, version, content FROM skill WHERE uri = $uri LIMIT 1",
    { uri }
  );

  if (skills[0]?.[0]) {
    res.json(skills[0][0]);
    return;
  }

  const resources = await db.query(
    "SELECT uri, version, content FROM resource WHERE uri = $uri LIMIT 1",
    { uri }
  );

  if (resources[0]?.[0]) {
    res.json(resources[0][0]);
    return;
  }

  res.status(404).json({ error: `Content not found: ${uri}` });
});

export default router;
