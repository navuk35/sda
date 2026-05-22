# Session Streaming: Stateful Agents via SurrealDB

## Overview

Claude Agent SDK stores conversation history in local JSONL files. This ties sessions to a specific agent instance -- if the container dies, sessions are lost. Session streaming solves this by persisting conversation state to SurrealDB in real-time, making agents truly disposable while preserving user sessions.

## The Problem

```
WITHOUT session streaming:

  Agent Instance A (container)
  ├── /workspace/.claude/sessions/
  │   ├── session_abc.jsonl    <-- trapped inside container
  │   └── session_def.jsonl    <-- trapped inside container
  │
  Container dies --> sessions LOST
  New container  --> starts fresh, no memory
```

## The Solution

```
WITH session streaming:

  Agent Instance A
  │
  │  Every message --> stream to SurrealDB
  │                    (conversation turns, tool calls, results)
  │
  Container dies --> no problem
  │
  Agent Instance B (new container, same --type)
  │
  │  On connect --> load session from SurrealDB
  │  User continues where they left off
```

## SurrealDB Schema

```sql
DEFINE TABLE session SCHEMAFULL;
DEFINE FIELD session_id ON session TYPE string;
DEFINE FIELD agent_type ON session TYPE string;
DEFINE FIELD user_id ON session TYPE string;
DEFINE FIELD status ON session TYPE string;       -- active, closed, expired
DEFINE FIELD created_at ON session TYPE datetime;
DEFINE FIELD updated_at ON session TYPE datetime;
DEFINE FIELD metadata ON session TYPE object;

DEFINE TABLE turn SCHEMAFULL;
DEFINE FIELD session ON turn TYPE record<session>;
DEFINE FIELD sequence ON turn TYPE int;
DEFINE FIELD role ON turn TYPE string;             -- user, assistant, tool_call, tool_result
DEFINE FIELD content ON turn TYPE string;
DEFINE FIELD tokens_used ON turn TYPE int;
DEFINE FIELD timestamp ON turn TYPE datetime;
DEFINE FIELD metadata ON turn TYPE object;         -- tool name, model, latency, etc.

DEFINE INDEX idx_session_user ON session FIELDS user_id;
DEFINE INDEX idx_session_type ON session FIELDS agent_type;
DEFINE INDEX idx_turn_session ON turn FIELDS session;
```

## Flow

### New Session

```
1. User sends first message to agent

2. Agent creates session in SurrealDB:
   CREATE session SET
     session_id = 'sess_abc123',
     agent_type = 'pricing-bot',
     user_id = 'user_42',
     status = 'active',
     created_at = time::now(),
     updated_at = time::now();

3. For each conversation turn:
   CREATE turn SET
     session = session:sess_abc123,
     sequence = 1,
     role = 'user',
     content = 'Why was the service charge $5 instead of $3?',
     timestamp = time::now();

   CREATE turn SET
     session = session:sess_abc123,
     sequence = 2,
     role = 'assistant',
     content = 'Looking at the pricing policy...',
     tokens_used = 342,
     timestamp = time::now();
```

### Session Recovery (Agent Restart)

```
1. New agent instance starts with --type=pricing-bot

2. User connects with existing session ID

3. Agent loads session from SurrealDB:
   SELECT * FROM turn
     WHERE session = session:sess_abc123
     ORDER BY sequence ASC;

4. Agent rebuilds conversation context from stored turns

5. User continues as if nothing happened
```

### Session Handoff (Horizontal Scaling)

```
User connected to Agent Instance A (overloaded)
  |
  | Load balancer redirects to Agent Instance B
  |
  v
Agent Instance B:
  1. Receives request with session_id
  2. Loads full session from SurrealDB
  3. Continues conversation seamlessly
  
  No sticky sessions needed.
```

## What Gets Streamed

| Data | Stored | Why |
|------|--------|-----|
| User messages | Yes | Rebuild conversation context |
| Assistant responses | Yes | Context continuity |
| Tool calls + results | Yes | Agent used Grep/Read/MCP -- results matter |
| Token counts | Yes | Usage tracking and billing |
| Timestamps | Yes | Latency analysis, session timeline |
| Model/version | Yes | Reproducibility and debugging |
| Errors | Yes | Debugging failed interactions |
| Intermediate thinking | No | Too verbose, not needed for recovery |

## Scaling Benefits

```
WITHOUT session streaming:
  User A --> sticky to Agent Instance 1 (always)
  User B --> sticky to Agent Instance 2 (always)
  User C --> sticky to Agent Instance 1 (always)

  Instance 1 overloaded, Instance 2 idle. Can't rebalance.

WITH session streaming:
  User A --> any instance (load balanced)
  User B --> any instance (load balanced)
  User C --> any instance (load balanced)

  All instances share load evenly.
  Kill any instance, spin new ones, zero impact.
```

## Session Lifecycle

```
active   --> user is interacting, turns being streamed
idle     --> no activity for 15 min, session stays in DB
closed   --> user explicitly ended, or timeout (24h)
archived --> moved to cold storage after 30 days
```

## SurrealDB Advantages for Sessions

| Feature | Benefit |
|---------|---------|
| LIVE queries | Admin can watch active sessions in real-time |
| Graph relations | `session -> turn -> tool_call` traversals |
| Time-series queries | Analyze session patterns over time |
| Built-in expiry | `DEFINE TABLE session ... AS SELECT * WHERE updated_at > time::now() - 24h` |
| Single DB | Sessions, skills, resources, catalogs -- all in one place |
