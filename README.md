# SDA: Server Driven Agents

A novel architecture pattern where AI agents are **generic stateless shells** whose identity, skills, knowledge, and codebase are loaded dynamically from a backend server at boot time.

> Like **Server Driven UI** (where the server controls what UI to render), **Server Driven Agents** let the server control what an agent *becomes*.

## Problem Statement

Building AI agents today requires creating separate, tightly-coupled agent applications for each domain. A "pricing agent" is a different codebase from a "KYC agent" which is different from a "payments agent." This leads to:

- **Code duplication** -- each agent reimplements boot logic, tool wiring, session management
- **Deployment overhead** -- separate Docker images, CI/CD pipelines, and infra per agent
- **Rigid updates** -- changing agent behavior requires redeployment
- **Knowledge silos** -- domain knowledge is baked into agent code, not shareable
- **Scaling complexity** -- each agent type scales independently

## Solution: Server Driven Agents

**One generic agent binary. One parameter. Any domain agent.**

```
agent --type=pricing-bot    --> becomes a pricing engine expert
agent --type=kyc-bot        --> becomes a KYC verification expert  
agent --type=payments-bot   --> becomes a payments domain expert
```

The agent itself contains zero domain knowledge. On boot, it calls a backend API with its `agentType` parameter, receives everything it needs (skills, knowledge docs, git repos to clone), writes them to its local filesystem, and starts serving.

## Architecture

```
               ┌──────────────────────────────────────────────┐
               │            Admin Portal (Web UI)              │
               │   Create/edit/version skills & resources      │
               │   Manage agent types, repos, MCP configs      │
               │   Review & approve changes before publish     │
               └──────────────────┬───────────────────────────┘
                                  │ CRUD
                                  ▼
                    ┌─────────────────────────────────────────┐
                    │             SurrealDB                    │
                    │  Tables: skills, resources, catalogs,    │
                    │          repos, mcp_servers              │
                    │                                         │
                    │  LIVE queries → push updates to agents   │
                    └────────────────┬────────────────────────┘
                                     │
                    Backend API (Spring Boot / any framework)
                    ┌─────────────────────────────────────────┐
                    │  GET /catalog/{agentType}                │
                    │  ← returns: skills[], resources[], repos[]│
                    │                                         │
                    │  GET /content/{uri}                      │
                    │  ← returns: versioned content            │
                    └────────────────┬────────────────────────┘
                                     │
                          REST API + SurrealDB LIVE queries
                                     │
              ┌──────────────────────┼──────────────────────┐
              │                      │                      │
              ▼                      ▼                      ▼
    ┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
    │ Agent Instance   │  │ Agent Instance   │  │ Agent Instance   │
    │ --type=pricing   │  │ --type=kyc       │  │ --type=payments  │
    │                  │  │                  │  │                  │
    │ Same binary      │  │ Same binary      │  │ Same binary      │
    │ Different param  │  │ Different param  │  │ Different param  │
    │                  │  │                  │  │                  │
    │ ┌──────────────┐ │  │ ┌──────────────┐ │  │ ┌──────────────┐ │
    │ │.claude/skills│ │  │ │.claude/skills│ │  │ │.claude/skills│ │
    │ │  (loaded)    │ │  │ │  (loaded)    │ │  │ │  (loaded)    │ │
    │ │docs/ (loaded)│ │  │ │docs/ (loaded)│ │  │ │docs/ (loaded)│ │
    │ │src/ (cloned) │ │  │ │src/ (cloned) │ │  │ │src/ (cloned) │ │
    │ └──────────────┘ │  │ └──────────────┘ │  │ └──────────────┘ │
    │                  │  │                  │  │                  │
    │ Third-party MCPs │  │ Third-party MCPs │  │ Third-party MCPs │
    │ ├── Jira         │  │ ├── Jira         │  │ ├── Jira         │
    │ ├── Slack         │  │ ├── GitHub       │  │ ├── Slack        │
    │ └── SigNoz       │  │ └── SigNoz       │  │ └── SigNoz       │
    └──────────────────┘  └──────────────────┘  └──────────────────┘
```

## Core Principles

### 1. Agent = Dumb Shell
The agent binary has zero domain knowledge. It only knows how to:
- Call a backend API to get its configuration
- Write files to its filesystem
- Use built-in tools (Grep, Read) to work with those files
- Connect to third-party MCP servers for external systems

### 2. Backend = Smart Brain
All intelligence lives in the backend, stored in **SurrealDB**:
- **Skills** (how agent behaves) -- versioned, hot-reloadable
- **Resources** (what agent knows) -- versioned, hot-reloadable
- **Repo manifests** (what code to clone) -- per agent type
- **Business logic** -- pricing calculations, KYC rules, etc.

An **Admin Portal** provides a web UI for domain experts to create, edit, version, and approve skills and resources without touching code.

### 3. No Custom MCP for Domain Knowledge
Domain docs and skills are served via direct REST API, not MCP. The agent writes them to its filesystem and uses Grep/Read (built-in tools) to search them -- exactly like Claude Code works locally.

MCP is used **only** for third-party external systems (Jira, Slack, GitHub, SigNoz) where pre-built MCP servers already exist.

### 4. Hot Reload via SurrealDB LIVE Queries
When skills or resources are updated (via Admin Portal or API):
1. SurrealDB detects the change and pushes via LIVE query
2. Agent receives the change notification in real-time
3. Agent fetches the new version
4. Agent replaces the file on its filesystem
5. Next query uses the updated content -- **zero restart**

No custom WebSocket server needed -- SurrealDB's built-in LIVE queries handle real-time push natively.

### 5. Truly Stateless (Cattle, Not Pets)
Kill an agent, spin a new one with the same `--type` parameter -- identical agent in seconds. Nothing is baked in. Everything is loaded on boot.

## Boot Sequence

```
1. Agent starts with: --type=pricing-bot

2. GET /catalog/pricing-bot
   Returns:
   {
     "skills": [
       { "uri": "skills://pricing-bot/debug-pricing", "version": "3.0" },
       { "uri": "skills://pricing-bot/analyze-issues", "version": "1.2" }
     ],
     "resources": [
       { "uri": "docs://pricing/overview", "version": "1.0" },
       { "uri": "docs://pricing/service-charge", "version": "2.1" }
     ],
     "repos": [
       { "url": "github.com/company/pricing-engine", "branch": "main" }
     ]
   }

3. For each skill: GET /content/{uri} --> write to .claude/skills/
4. For each resource: GET /content/{uri} --> write to docs/
5. For each repo: git clone --> /workspace/src/
6. Subscribe to WebSocket: /notifications/pricing-bot
7. Agent is ready.
```

## When to Use SDA

| Scenario | Use SDA? |
|----------|----------|
| Multiple domain agents sharing the same agent infrastructure | Yes |
| Need to update agent behavior without redeployment | Yes |
| Teams that want to manage agent skills via a CMS/admin panel | Yes |
| Single-purpose agent that never changes | Overkill |
| Prototyping / learning | Start simple, evolve to SDA |

## Comparison with Existing Patterns

| Pattern | Similarity | What SDA Adds |
|---------|-----------|---------------|
| OpenAI Shell + Skills | Skills loading | Server-driven identity, dynamic repos, hot-reload |
| Cloudflare Dynamic Workers | Stateless containers | Domain identity injection, skill versioning |
| Spring AI Agent Skills | Skill discovery | Backend-driven, not bundled |
| Server Driven UI (Airbnb) | Server controls client | Applied to agents instead of UI |

## Tech Stack (Reference Implementation)

| Layer | Technology |
|-------|-----------|
| Agent Runtime | Claude Agent SDK (TypeScript) |
| Backend API | Spring Boot / Express / any REST framework |
| Storage | SurrealDB (multi-model DB with LIVE queries) |
| Real-time Updates | SurrealDB LIVE queries (no custom WebSocket) |
| Admin Portal | Web UI for skill/resource management |
| Third-party MCPs | Jira, Slack, GitHub, SigNoz (plug-and-play) |
| Container Infra | E2B / Modal / Fly / Kubernetes |
| Observability | SigNoz (OTLP) |

## Project Structure

```
sda/
├── README.md                          # This file
├── docs/
│   ├── architecture.md                # Detailed architecture docs
│   ├── boot-sequence.md               # Agent boot lifecycle
│   ├── skill-vs-resource.md           # How to classify content
│   └── hot-reload.md                  # Update notification flow
├── examples/
│   ├── backend-api/                   # Reference backend implementation
│   │   ├── src/
│   │   │   ├── index.ts               # Express server entry point
│   │   │   ├── catalog.ts             # GET /catalog/{agentType}
│   │   │   ├── content.ts             # GET /content/{uri}
│   │   │   ├── db.ts                  # SurrealDB connection + queries
│   │   │   └── notifications.ts       # LIVE query subscription handler
│   │   └── package.json
│   └── agent-runner/                  # Reference agent boot script
│       ├── src/
│       │   ├── boot.ts                # Boot sequence implementation
│       │   ├── sync.ts                # File sync + hot reload
│       │   └── index.ts               # Main entry point
│       └── package.json
└── LICENSE
```

## Status

This is an early-stage architecture proposal. Contributions, feedback, and corrections are welcome.

## Author

**Navin M** -- Principal Architect with 14+ years in distributed systems (Java/Spring Boot), exploring AI agent architecture patterns.

## License

MIT
