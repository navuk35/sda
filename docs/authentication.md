# Authentication: API Key Security

## Overview

SDA uses API key authentication to secure communication between agents and the backend. Keys are issued per subscription, stored encrypted in environment variables, and validated by backend middleware on every request.

## How It Works

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│  1. Customer buys subscription --> receives API key          │
│  2. Key is encrypted and stored in Docker env var            │
│  3. Agent decrypts key at startup                            │
│  4. Every request to backend includes the key                │
│  5. Backend middleware validates before processing           │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

## Key Lifecycle

```
Key Creation:
  Customer subscribes --> Backend generates API key
                          --> Stores hashed key in SurrealDB
                          --> Returns plaintext key ONCE to customer
                          --> Customer never sees it again

Key Storage (Docker):
  Customer encrypts key --> stores as env var in Docker config
  
  docker run \
    -e SDA_API_KEY_ENCRYPTED="aes256:base64encodedstring..." \
    -e SDA_ENCRYPTION_KEY="<from secrets manager>" \
    -e AGENT_TYPE="pricing-bot" \
    sda-agent

Key Usage (Agent Boot):
  Agent starts
    --> reads SDA_API_KEY_ENCRYPTED from env
    --> decrypts using SDA_ENCRYPTION_KEY
    --> uses plaintext key for all backend API calls
    --> plaintext key lives only in memory, never on disk
```

## Agent Startup with Auth

```
STEP 1: Read and decrypt API key
        encryptedKey = process.env.SDA_API_KEY_ENCRYPTED
        encryptionKey = process.env.SDA_ENCRYPTION_KEY
        apiKey = decrypt(encryptedKey, encryptionKey)

STEP 2: Validate key against backend
        GET {backendUrl}/api/v1/auth/validate
        Headers: { Authorization: Bearer {apiKey} }
        Response: { valid: true, plan: "pro", agentTypes: ["pricing-bot", "kyc-bot"] }

STEP 3: Proceed with normal boot (fetch catalog, skills, etc.)
        All subsequent requests include: Authorization: Bearer {apiKey}

STEP 4: If key is invalid or expired
        Agent logs error and exits immediately
        Does NOT start serving
```

## Backend Middleware (Hono)

Implemented in `examples/backend-api/src/auth.ts`.

```typescript
// middleware/auth.ts

import { getDb } from "../db.js";

export async function authenticate(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing API key" });
  }

  const apiKey = authHeader.slice(7);
  const keyHash = sha256(apiKey);

  const [subscription] = await getDb().query(
    `SELECT * FROM subscription WHERE key_hash = $hash AND status = 'active'`,
    { hash: keyHash }
  );

  if (!subscription) {
    return res.status(401).json({ error: "Invalid or expired API key" });
  }

  // Attach subscription context to request
  req.subscription = subscription;
  next();
}
```

## SurrealDB Schema for Subscriptions

```sql
DEFINE TABLE subscription SCHEMAFULL;
DEFINE FIELD customer_id ON subscription TYPE string;
DEFINE FIELD key_hash ON subscription TYPE string;       -- SHA-256 of plaintext key
DEFINE FIELD plan ON subscription TYPE string;           -- free, pro, enterprise
DEFINE FIELD agent_types ON subscription TYPE array;     -- which agent types are allowed
DEFINE FIELD max_agents ON subscription TYPE int;        -- concurrent agent limit
DEFINE FIELD status ON subscription TYPE string;         -- active, suspended, expired
DEFINE FIELD created_at ON subscription TYPE datetime;
DEFINE FIELD expires_at ON subscription TYPE datetime;

DEFINE INDEX idx_key_hash ON subscription FIELDS key_hash UNIQUE;
```

## What the Middleware Enforces

| Check | What Happens |
|-------|-------------|
| Missing key | 401 Unauthorized |
| Invalid key | 401 Unauthorized |
| Expired subscription | 403 Forbidden |
| Wrong agent type | 403 -- subscription doesn't include this agent type |
| Max agents exceeded | 429 -- too many concurrent agents for this plan |
| Valid key | Request proceeds, subscription context attached |

## Request Flow

```
Agent                           Backend
  |                                |
  |  GET /api/v1/catalog/pricing-bot
  |  Authorization: Bearer sk_live_abc123
  |------------------------------->|
  |                                |
  |                    Middleware:
  |                    1. Extract key from header
  |                    2. Hash it: SHA-256(sk_live_abc123)
  |                    3. Query SurrealDB for matching subscription
  |                    4. Check: status = active?
  |                    5. Check: "pricing-bot" in agent_types?
  |                    6. Check: concurrent agents < max_agents?
  |                    7. Attach subscription to request
  |                                |
  |  200 OK { catalog data }       |
  |<-------------------------------|
```

## Key Rotation

```
1. Customer requests key rotation via Admin Portal or API

2. Backend:
   - Generates new API key
   - Stores new key_hash in SurrealDB
   - Marks old key as "rotating" (still valid for grace period)
   - Returns new plaintext key to customer

3. Customer updates Docker env var with new encrypted key

4. After grace period (e.g., 24 hours):
   - Old key is invalidated
   - Only new key works

5. Agents using old key will fail auth on next boot
   --> Operator updates env var and restarts
```

## Transport Security

```
All communication over HTTPS (TLS 1.3):

  Agent  --HTTPS-->  Backend API
  Agent  --WSS--->   SurrealDB LIVE queries

  API key travels encrypted in transit.
  Encrypted at rest in Docker env vars.
  Plaintext only exists in agent process memory.
  
  No key is ever:
  - Written to disk on the agent
  - Logged in plaintext
  - Included in error messages
  - Stored in session data
```

## Docker Compose Example

```yaml
services:
  pricing-agent:
    image: sda-agent:latest
    environment:
      AGENT_TYPE: "pricing-bot"
      BACKEND_URL: "https://api.sda-platform.com"
      SDA_API_KEY_ENCRYPTED: "${SDA_API_KEY_ENCRYPTED}"
      SDA_ENCRYPTION_KEY: "${SDA_ENCRYPTION_KEY}"  # from secrets manager
    deploy:
      replicas: 3
```
