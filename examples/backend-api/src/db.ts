/**
 * db.ts — SurrealDB connection and seed data (surrealdb.js v2).
 */

import { Surreal, Table } from "surrealdb";

let db: Surreal;

export async function connectDb(): Promise<Surreal> {
  db = new Surreal();
  await db.connect(process.env.SURREAL_URL || "http://localhost:8000/rpc");
  await db.signin({
    username: process.env.SURREAL_USER || "root",
    password: process.env.SURREAL_PASS || "root",
  });
  await db.use({ namespace: "sda", database: "agents" });
  return db;
}

export function getDb(): Surreal {
  if (!db) throw new Error("Database not connected");
  return db;
}

export async function seedData() {
  // Check if data exists using query builder
  const existing = await db.select<{ id: string }>(new Table("catalog"));
  if (existing.length > 0) return;

  // Insert skills
  await db.create(new Table("skill")).content({
    uri: "skills://pricing-bot/debug-pricing",
    version: "1.0",
    hash: "a1b2c3",
    agent_type: "pricing-bot",
    content: `# How to Debug Pricing Issues

1. First check which policies are active for the transaction type
2. Verify policy evaluation order: service_charge -> commission -> tax -> discount
3. Check if any conditions are misconfigured (wrong channel, wrong tier)
4. Look at recent git changes to pricing config files
5. NEVER modify pricing configs without explicit approval
6. Always show the before/after calculation when suggesting a fix
7. If confidence is below 80%, escalate to human`,
  });

  await db.create(new Table("skill")).content({
    uri: "skills://pricing-bot/analyze-issues",
    version: "1.0",
    hash: "d4e5f6",
    agent_type: "pricing-bot",
    content: `# How to Analyze L4 Issues

1. Read the Jira ticket fully
2. Search docs for related pricing concepts
3. Grep codebase for keywords from the ticket
4. Read relevant source files
5. Check git log for recent changes
6. Provide analysis with: Summary, Root Cause, Affected Files, Impact, Suggested Fix, Confidence Level`,
  });

  // Insert resources
  await db.create(new Table("resource")).content({
    uri: "docs://pricing/overview",
    version: "1.0",
    hash: "g7h8i9",
    agent_type: "pricing-bot",
    content: `# Pricing Engine Overview

The pricing engine determines fees, commissions, and taxes for mobile money transactions.

Policy evaluation order:
1. Service Charge Policy - what the user pays
2. Commission Policy - what the agent earns
3. Transaction Tax Policy - government levies
4. Discount Policy - promotional reductions

Each policy has: conditions (who/what/when), calculation method (flat/percentage/tiered), and priority (evaluation order).`,
  });

  await db.create(new Table("resource")).content({
    uri: "docs://pricing/service-charge",
    version: "1.0",
    hash: "j0k1l2",
    agent_type: "pricing-bot",
    content: `# Service Charge Policy

Defines fees charged to end-users for transactions.

Types:
- Flat fee: fixed amount (e.g., $0.50 per txn)
- Percentage: % of transaction amount (e.g., 1.5%)
- Tiered: different rates based on amount ranges`,
  });

  await db.create(new Table("resource")).content({
    uri: "docs://pricing/commission",
    version: "1.0",
    hash: "m3n4o5",
    agent_type: "pricing-bot",
    content: `# Commission Policy

Defines earnings for agents/merchants per transaction.

- Source: deducted from service charge or separate pool
- Split: Super Agent 40%, Agent 50%, Platform 10%
- Settlement: real-time or batched (daily/weekly)
- Clawback: reversed if transaction is disputed within 30 days`,
  });

  // Insert catalog
  await db.create(new Table("catalog")).content({
    agent_type: "pricing-bot",
    version: "1.0",
    repos: [
      { url: "https://github.com/company/pricing-engine", name: "pricing-engine", branch: "main" },
    ],
    mcp_servers: [
      { name: "jira", command: "npx", args: ["-y", "@anthropic-ai/mcp-server-jira"] },
    ],
  });

  console.log("Seed data loaded into SurrealDB");
}
