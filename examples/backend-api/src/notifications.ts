import { getDb } from "./db.js";

export async function setupLiveQueries() {
  const db = getDb();

  await db.live("skill", (action, result) => {
    console.log(`LIVE [skill] ${action}: ${result.uri} v${result.version}`);
  });

  await db.live("resource", (action, result) => {
    console.log(`LIVE [resource] ${action}: ${result.uri} v${result.version}`);
  });

  console.log("SurrealDB LIVE queries active for skill and resource tables");
}
