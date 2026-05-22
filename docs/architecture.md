# SDA Architecture

## Overview

Server Driven Agents (SDA) separates agent **identity** from agent **infrastructure**. The infrastructure (boot logic, tool wiring, MCP connections) is built once. The identity (skills, knowledge, codebase) is loaded dynamically from a backend server.

## Four Components

### 1. SurrealDB (The Store)

SurrealDB is the single source of truth for all agent configurations. It stores skills, resources, catalogs, repos, and MCP server configs as structured records with full versioning.

**Why SurrealDB:**
- **Multi-model** -- document, graph, and relational in one DB
- **LIVE queries** -- built-in real-time push when records change (replaces custom WebSocket infrastructure)
- **SurrealQL** -- expressive query language with relations and graph traversals
- **Embedded or networked** -- can run as a sidecar or standalone cluster

**Schema:**
```sql
DEFINE TABLE catalog SCHEMAFULL;
DEFINE FIELD agent_type ON catalog TYPE string;
DEFINE FIELD version ON catalog TYPE string;
DEFINE FIELD skills ON catalog TYPE array<record<skill>>;
DEFINE FIELD resources ON catalog TYPE array<record<resource>>;
DEFINE FIELD repos ON catalog TYPE array<object>;
DEFINE FIELD mcp_servers ON catalog TYPE array<object>;

DEFINE TABLE skill SCHEMAFULL;
DEFINE FIELD uri ON skill TYPE string;
DEFINE FIELD version ON skill TYPE string;
DEFINE FIELD hash ON skill TYPE string;
DEFINE FIELD content ON skill TYPE string;
DEFINE FIELD agent_type ON skill TYPE string;

DEFINE TABLE resource SCHEMAFULL;
DEFINE FIELD uri ON resource TYPE string;
DEFINE FIELD version ON resource TYPE string;
DEFINE FIELD hash ON resource TYPE string;
DEFINE FIELD content ON resource TYPE string;
DEFINE FIELD agent_type ON resource TYPE string;
```

### 2. Backend API (The Brain)

A thin REST layer over SurrealDB. It exposes two endpoints:

```
GET  /api/v1/catalog/{agentType}     # What to load
GET  /api/v1/content/{uri}           # Load each item
```

No WebSocket endpoint needed -- agents subscribe to SurrealDB LIVE queries directly for real-time updates.

**Catalog Response:**
```json
{
  "agentType": "pricing-bot",
  "version": "2.1",
  "skills": [
    { "uri": "skills://pricing-bot/debug-pricing", "version": "3.0", "hash": "abc123" }
  ],
  "resources": [
    { "uri": "docs://pricing/overview", "version": "1.0", "hash": "def456" }
  ],
  "repos": [
    { "url": "github.com/company/pricing-engine", "branch": "main", "sparse": "/src" }
  ],
  "mcpServers": [
    { "name": "jira", "command": "npx", "args": ["-y", "@anthropic-ai/mcp-server-jira"] }
  ]
}
```

The backend can be built with any framework (Spring Boot, Express, FastAPI). It manages:
- Versioning of skills and resources
- Agent type registry
- CRUD operations on all content

### 3. Admin Portal (The Control Plane)

A web UI for domain experts to manage agent content without touching code:
- Create, edit, and version skills and resources
- Manage agent type catalogs (which skills/resources/repos belong to which agent)
- Review and approve changes before they go live
- View connected agents and their loaded versions

Changes made via the Admin Portal are written to SurrealDB, which automatically pushes updates to connected agents via LIVE queries.

### 4. Agent Runner (The Hands)

A generic TypeScript binary that:
1. Reads `--type` parameter
2. Calls backend API to get catalog
3. Writes skills/resources to filesystem
4. Clones git repos
5. Connects to specified MCP servers
6. Subscribes to SurrealDB LIVE queries for updates
7. Starts serving via Claude Agent SDK `query()`

The agent runner has **zero domain knowledge**. It is identical across all deployments.

### 5. Third-Party MCP Servers (External Connectors)

Pre-built MCP servers for external systems. These are the only MCP servers in the architecture:
- Jira (ticket management)
- Slack (messaging)
- GitHub (code, PRs, issues)
- SigNoz (logs, metrics, alerts)

No custom MCP server is built for domain knowledge. Domain docs live in the backend and are written to the agent's filesystem.

## Data Flow

### Boot Flow
```
Agent --type=X --> Backend GET /catalog/X --> skills[], resources[], repos[]
                                          |
                    For each skill:  GET /content/{uri} --> write to .claude/skills/
                    For each resource: GET /content/{uri} --> write to docs/
                    For each repo: git clone --> /workspace/src/
                    For each MCP: connect
                    Subscribe: WS /notifications/X
                                          |
                                     Agent Ready
```

### Query Flow
```
User Question --> Agent
                    |
                    |--> Grep/Read local docs (filesystem)
                    |--> Grep/Read local codebase (filesystem)
                    |--> Call MCP tools (Jira, Slack) if needed
                    |
                    --> Response
```

### Update Flow
```
Admin updates skill v3.1 via Admin Portal
                                |
                                --> SurrealDB stores new version
                                |
                                --> LIVE query triggers notification to subscribed agents
                                |
Agent receives notification --> GET /content/{uri} --> replace file
                                |
                           Next query uses v3.1
```

## Skill vs Resource Classification

Every piece of content falls into one of two categories:

| Ask This | If YES | Example |
|----------|--------|---------|
| "Does this describe WHAT something IS?" | Resource (docs/) | "Service charge is a fee charged to users..." |
| "Does this describe HOW the agent should BEHAVE?" | Skill (.claude/skills/) | "When debugging, always check policy order first..." |
| Contains both? | Split the file | Facts -> resource, Instructions -> skill |

## Security Considerations

- Backend API should require authentication (API key, OAuth)
- Git repos should use deploy keys or tokens (not personal credentials)
- MCP servers should use scoped credentials
- Agent containers should have network policies (only access backend + MCP endpoints)
- Skills/resources should be integrity-checked (hash verification after download)
