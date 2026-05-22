# Hot Reload: Live Updates Without Restart

## Overview

SDA agents update their skills and knowledge in real-time via **SurrealDB LIVE queries**. No custom WebSocket server, no container restart, no redeployment, no downtime.

## How LIVE Queries Work

SurrealDB LIVE queries are a built-in feature that pushes change notifications to connected clients whenever records matching a query are created, updated, or deleted. This eliminates the need for custom WebSocket infrastructure.

```sql
-- Agent subscribes at boot time
LIVE SELECT * FROM skill WHERE agent_type = 'pricing-bot';
LIVE SELECT * FROM resource WHERE agent_type = 'pricing-bot';
```

## Flow

```
1. Domain expert updates skill "debug-pricing" to v3.1 via Admin Portal

2. Admin Portal writes to SurrealDB:
   UPDATE skill SET version = '3.1', content = '...', hash = 'xyz789'
     WHERE uri = 'skills://pricing-bot/debug-pricing';

3. SurrealDB LIVE query fires automatically to all subscribed agents:
   {
     "action": "UPDATE",
     "result": {
       "uri": "skills://pricing-bot/debug-pricing",
       "version": "3.1",
       "hash": "xyz789",
       "content": "..."
     }
   }

4. Each subscribed agent:
   a. Receives the change notification with full content
   b. Deletes old file: /workspace/.claude/skills/debug-pricing.md
   c. Writes new file: /workspace/.claude/skills/debug-pricing.md (v3.1)

5. Next user query uses the updated skill
```

## LIVE Query Actions

| SurrealDB Action | Agent Response |
|------------------|----------------|
| `CREATE` | Write new file to filesystem |
| `UPDATE` | Replace existing file with new version |
| `DELETE` | Delete file from filesystem |

## Consistency Guarantees

- **Eventual consistency**: agents may serve stale content for a few seconds between notification and file replacement
- **Atomic file replacement**: write to temp file first, then rename (prevents partial reads)
- **Version tracking**: agent tracks loaded versions, skips re-fetch if already current (hash check)
- **LIVE query reconnection**: if the SurrealDB connection drops, agent reconnects and re-subscribes automatically

## Rollback

If a bad skill update is deployed:

```
1. Domain expert rolls back via Admin Portal (restores v3.0)
2. SurrealDB LIVE query fires: UPDATE with version 3.0
3. All subscribed agents receive the change and replace the file
4. Recovery in seconds, no restart
```

## Why SurrealDB Over Custom WebSocket

| Aspect | Custom WebSocket | SurrealDB LIVE Queries |
|--------|-----------------|----------------------|
| Server code | Build + maintain WebSocket server | Zero -- built into DB |
| Client tracking | Manual connection management | Handled by DB driver |
| Filtering | Custom routing logic per agent type | SQL WHERE clause |
| Reconnection | Custom retry logic | DB driver handles it |
| Scaling | Sticky sessions or pub/sub layer | DB cluster handles it |
