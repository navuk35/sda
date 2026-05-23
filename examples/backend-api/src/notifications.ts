/**
 * notifications.ts — SurrealDB LIVE query setup (surrealdb.js v2).
 */

import { getDb } from "./db.js";
import { Table } from "surrealdb";

export async function setupLiveQueries() {
  const db = getDb();

  // v2 live queries use async iterators
  const skillTable = new Table("skill");
  const resourceTable = new Table("resource");

  const skillLive = await db.live(skillTable);
  const resourceLive = await db.live(resourceTable);

  // Start listening in background
  (async () => {
    for await (const { action, value } of skillLive) {
      const v = value as { uri?: string; version?: string };
      console.log(`LIVE [skill] ${action}: ${v.uri} v${v.version}`);
    }
  })();

  (async () => {
    for await (const { action, value } of resourceLive) {
      const v = value as { uri?: string; version?: string };
      console.log(`LIVE [resource] ${action}: ${v.uri} v${v.version}`);
    }
  })();

  console.log("SurrealDB LIVE queries active for skill and resource tables");
}
