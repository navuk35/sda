# Agent Boot Sequence

## Overview

The boot sequence transforms a generic agent binary into a domain-specific agent in seconds.

## Steps

```
STEP 0: Decrypt and validate API key
        encryptedKey = process.env.SDA_API_KEY_ENCRYPTED
        encryptionKey = process.env.SDA_ENCRYPTION_KEY
        apiKey = decrypt(encryptedKey, encryptionKey)
        GET {backendUrl}/api/v1/auth/validate  [Authorization: Bearer {apiKey}]
        If invalid --> log error, exit immediately

STEP 1: Read parameters
        agentType = process.env.AGENT_TYPE || process.argv[2]
        backendUrl = process.env.BACKEND_URL

STEP 2: Fetch catalog (authenticated)
        GET {backendUrl}/api/v1/catalog/{agentType}  [Authorization: Bearer {apiKey}]
        Response: { skills[], resources[], repos[], mcpServers[] }

STEP 3: Write skills to filesystem
        For each skill in catalog.skills:
          GET {backendUrl}/api/v1/content/{skill.uri}
          Write to: /workspace/.pi/skills/{name}.md

STEP 4: Write resources to filesystem
        For each resource in catalog.resources:
          GET {backendUrl}/api/v1/content/{resource.uri}
          Write to: /workspace/docs/{path}.md

STEP 5: Clone repositories
        For each repo in catalog.repos:
          git clone --depth 1 --branch {repo.branch} {repo.url} /workspace/src/{repo.name}

STEP 6: Connect MCP servers
        For each mcp in catalog.mcpServers:
          Start MCP server process with specified command and args

STEP 7: Subscribe to updates via SurrealDB LIVE queries
        LIVE SELECT * FROM skill WHERE agent_type = {agentType}
        LIVE SELECT * FROM resource WHERE agent_type = {agentType}
        On change:
          - CREATE/UPDATE -> fetch new version, replace file
          - DELETE         -> delete file from filesystem

STEP 8: Connect session store
        Connect to SurrealDB for session streaming via Pi SDK SessionManager
        Load existing session if user reconnects (SELECT * FROM turn WHERE session = {id})
        Stream all new conversation turns to SurrealDB in real-time

STEP 9: Agent is ready
        Start serving via Pi SDK `session.prompt()`
        Accepts queries via HTTP POST /query endpoint
```

## Filesystem After Boot

```
/workspace/
├── .pi/
│   └── skills/
│       ├── debug-pricing.md        # Loaded from backend
│       └── analyze-issues.md       # Loaded from backend
├── docs/
│   ├── pricing/
│   │   ├── overview.md             # Loaded from backend
│   │   ├── service-charge.md       # Loaded from backend
│   │   └── commission.md           # Loaded from backend
├── src/
│   └── pricing-engine/             # Cloned from git
│       ├── src/
│       ├── tests/
│       └── package.json
└── CLAUDE.md                       # Can also be loaded from backend
```

## Boot Time Targets

| Step | Expected Duration |
|------|------------------|
| Fetch catalog | <100ms |
| Write skills (5 files) | <50ms |
| Write resources (10 files) | <100ms |
| Clone repo (shallow) | 2-10s (depends on repo size) |
| Connect MCPs | 1-3s |
| **Total boot** | **~5-15 seconds** |

## Health Check

After boot, the agent should report its loaded configuration via GET /health:

```json
{
  "agentType": "pricing-bot",
  "status": "ready",
  "skills": ["skills://pricing-bot/debug-pricing@v1.0", "skills://pricing-bot/analyze-issues@v1.0"],
  "resources": ["docs://pricing/overview@v1.0", "docs://pricing/service-charge@v1.0", "docs://pricing/commission@v1.0"],
  "repos": ["pricing-engine@main"],
  "bootTime": "4.2s"
}
```
