/**
 * sync.ts — Hot reload via SurrealDB LIVE queries (surrealdb.js v2).
 *
 * Subscribes to SurrealDB LIVE queries for skill and resource changes.
 * When backend content is updated (via Admin Portal or API):
 *   1. SurrealDB pushes change notification
 *   2. Agent fetches new version from backend
 *   3. Agent replaces file on filesystem (atomic: write temp → rename)
 *   4. Next query uses updated content — zero restart
 */

import { writeFileSync, unlinkSync, renameSync } from "node:fs";
import { join } from "node:path";
import { Surreal, Table } from "surrealdb";
import { fetchContent } from "./catalog.js";

export interface SyncOptions {
  backendUrl: string;
  apiKey: string;
  agentType: string;
  surrealUrl: string;
  surrealUser: string;
  surrealPass: string;
  surrealNamespace: string;
  surrealDatabase: string;
  skillsDir: string;
  resourcesDir: string;
}

export async function subscribeToLiveQueries(options: SyncOptions): Promise<Surreal> {
  const db = new Surreal();
  await db.connect(options.surrealUrl);
  await db.signin({
    username: options.surrealUser,
    password: options.surrealPass,
  });
  await db.use({
    namespace: options.surrealNamespace,
    database: options.surrealDatabase,
  });

  // Live queries require WebSocket. Skip gracefully on HTTP connections.
  try {
    const skillLive = await db.live(new Table("skill"));
    skillLive.subscribe(async ({ action, value }) => {
      const uri = (value as { uri?: string; agent_type?: string; version?: string }).uri;
      if (!uri) return;
      if ((value as { agent_type?: string }).agent_type !== options.agentType) return;

      const name = uri.split("/").pop() || uri;

      if (action === "CREATE" || action === "UPDATE") {
        try {
          const { content } = await fetchContent(options.backendUrl, uri, options.apiKey);
          const filePath = join(options.skillsDir, `${name}.md`);
          const tmpPath = filePath + ".tmp";
          writeFileSync(tmpPath, content, "utf-8");
          renameSync(tmpPath, filePath);
          console.log(
            `  🔄 [LIVE] Skill updated: ${name} → v${(value as { version?: string }).version}`,
          );
        } catch (err) {
          console.error(`  ❌ [LIVE] Failed to update skill ${name}:`, err);
        }
      } else if (action === "DELETE") {
        try {
          unlinkSync(join(options.skillsDir, `${name}.md`));
          console.log(`  🗑 [LIVE] Skill deleted: ${name}`);
        } catch { /* already gone */ }
      }
    });

    const resourceLive = await db.live(new Table("resource"));
    resourceLive.subscribe(async ({ action, value }) => {
      const uri = (value as { uri?: string; agent_type?: string; version?: string }).uri;
      if (!uri) return;
      if ((value as { agent_type?: string }).agent_type !== options.agentType) return;

      const relPath = uri.replace(/^docs:\/\//, "");

      if (action === "CREATE" || action === "UPDATE") {
        try {
          const { content } = await fetchContent(options.backendUrl, uri, options.apiKey);
          const filePath = join(options.resourcesDir, `${relPath}.md`);
          const tmpPath = filePath + ".tmp";
          writeFileSync(tmpPath, content, "utf-8");
          renameSync(tmpPath, filePath);
          console.log(
            `  🔄 [LIVE] Resource updated: ${relPath} → v${(value as { version?: string }).version}`,
          );
        } catch (err) {
          console.error(`  ❌ [LIVE] Failed to update resource ${relPath}:`, err);
        }
      } else if (action === "DELETE") {
        try {
          unlinkSync(join(options.resourcesDir, `${relPath}.md`));
          console.log(`  🗑 [LIVE] Resource deleted: ${relPath}`);
        } catch { /* already gone */ }
      }
    });

    console.log(`[SDA] SurrealDB LIVE queries active for skills and resources`);
  } catch (err) {
    console.log(
      `[SDA] LIVE queries unavailable (HTTP transport): hot reload disabled`,
    );
  }
  return db;
}
