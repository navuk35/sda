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
          Write to: /workspace/.claude/skills/{name}.md

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
        Connect to SurrealDB for session streaming
        Load existing session if user reconnects (SELECT * FROM turn WHERE session = {id})
        Stream all new conversation turns to SurrealDB in real-time

STEP 9: Agent is ready
        Start serving via Claude Agent SDK query()
```

## Filesystem After Boot

```
/workspace/
├── .claude/
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

After boot, the agent should report its loaded configuration:

```json
{
  "agentType": "pricing-bot",
  "status": "ready",
  "skills": ["debug-pricing@v3.0", "analyze-issues@v1.2"],
  "resources": ["pricing/overview@v1.0", "pricing/service-charge@v2.1"],
  "repos": ["pricing-engine@main#abc123"],
  "mcpServers": ["jira", "signoz"],
  "bootTime": "4.2s"
}
```
