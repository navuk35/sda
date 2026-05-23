# Getting Started

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Docker | Latest | [docker.com](https://docker.com) |
| Node.js | 22+ | [nodejs.org](https://nodejs.org) |
| SurrealDB CLI | Latest | `brew install surrealdb` or [surrealdb.com/install](https://surrealdb.com/install) |

## 1. Start SurrealDB

```bash
docker run -d --name surrealdb -p 8000:8000 \
  surrealdb/surrealdb:latest start --user root --pass root
```

Use `surreal-kv:data.db` for persistent storage:
```bash
docker run -d --name surrealdb -p 8000:8000 \
  -v surreal-data:/data \
  surrealdb/surrealdb:latest start --user root --pass root surrealkv:/data/main.db
```

## 2. Import Schema & Seed Data

Schema files use `OPTION IMPORT;` and `DEFINE TABLE OVERWRITE` (idempotent — safe to run multiple times).

```bash
cd sda

# Create namespace + database + tables
surreal import --endpoint http://localhost:8000 --user root --pass root \
  --namespace sda --database agents db/schema.surql

# Insert sample pricing-bot data
surreal import --endpoint http://localhost:8000 --user root --pass root \
  --namespace sda --database agents db/seed.surql
```

Verify:
```bash
echo "SELECT count() FROM skill; SELECT count() FROM resource;" | \
  surreal sql --endpoint http://localhost:8000 --user root --pass root \
  --namespace sda --database agents
# Should show: 2 skills, 3 resources
```

## 3. Run Backend API

```bash
cd examples/backend-api
npm install
npm run dev
# SDA Backend API (Hono) running on http://localhost:3000
```

### Test with curl

```bash
# Health check
curl http://localhost:3000/health
# {"status":"ok"}

# Validate test API key
curl http://localhost:3000/api/v1/auth/validate \
  -H "Authorization: Bearer sk_test_sda_integration_2026"
# {"valid":true,"plan":"pro","agentTypes":["pricing-bot","kyc-bot"]}

# Get catalog
curl -s http://localhost:3000/api/v1/catalog/pricing-bot \
  -H "Authorization: Bearer sk_test_sda_integration_2026" | jq

# Get skill content
curl -s http://localhost:3000/api/v1/content/skills%3A%2F%2Fpricing-bot%2Fdebug-pricing \
  -H "Authorization: Bearer sk_test_sda_integration_2026" | jq
```

## 4. Run Tests

```bash
cd examples/backend-api
npm test
# 16 integration tests against real SurrealDB
# Uses Hono's app.request() — no HTTP server needed
```

Test coverage:
- Health check (1 test)
- Authentication (4 tests — valid, missing, invalid, malformed headers)
- Catalog endpoint (3 tests — data, auth, 404)
- Content endpoint (4 tests — skill, resource, 404, auth)
- Seed data integrity (4 tests)

## 5. Run Agent Runner (Pi SDK)

The agent runner uses the Pi Coding Agent SDK to create a domain-specific agent session.

```bash
cd examples/agent-runner
npm install

# Set environment variables
export AGENT_TYPE=pricing-bot
export SDA_API_KEY=sk_test_sda_integration_2026
export BACKEND_URL=http://localhost:3000
export SURREAL_URL=http://localhost:8000/rpc
export SURREAL_USER=root
export SURREAL_PASS=root

npm run dev
# [SDA] Booting agent: pricing-bot
# [SDA] Agent listening on http://localhost:3001
```

### Query the agent

```bash
curl -X POST http://localhost:3001/query \
  -H "Content-Type: application/json" \
  -d '{"prompt":"What is the service charge policy?"}'
```

### Health check

```bash
curl http://localhost:3001/health
# {"status":"ready","agentType":"pricing-bot","skills":[...],"resources":[...],"bootTime":"1.2s"}
```

## 6. Configure Web Search (Optional)

The agent can use web search via Gemini API (free tier):

```bash
echo '{"geminiApiKey":"AIza..."}' > ~/.pi/web-search.json
```

Get a key from [aistudio.google.com](https://aistudio.google.com).

## Development Workflow

```
1. Edit backend code  → tsx watch auto-reloads
2. Run tests          → npm test (16 tests, <1s)
3. Update schema      → edit db/schema.surql → surreal import
4. Update seed data   → edit db/seed.surql → surreal import
5. Check DB state     → surreal sql --endpoint ... --namespace sda --database agents
```

## Architecture

```
                    ┌──────────────────────────┐
                    │    SurrealDB (Docker)     │
                    │    sda/agents             │
                    │    Port 8000              │
                    └──────────┬───────────────┘
                               │
                    ┌──────────┴───────────────┐
                    │   Backend API (Hono)      │
                    │   Port 3000               │
                    │   /health                 │
                    │   /api/v1/auth/validate   │
                    │   /api/v1/catalog/:type   │
                    │   /api/v1/content/:uri    │
                    └──────────┬───────────────┘
                               │
                    ┌──────────┴───────────────┐
                    │   Agent Runner (Pi SDK)   │
                    │   Port 3001               │
                    │   Boot → Catalog → Session│
                    │   LIVE queries for reload │
                    └──────────────────────────┘
```
