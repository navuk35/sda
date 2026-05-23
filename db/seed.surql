OPTION IMPORT;
-- ============================================================
-- SDA — Seed data for pricing-bot agent
-- Run with:
-- surreal import --endpoint http://localhost:8000 --user root --pass root --namespace sda --database agents db/seed.surql
-- ============================================================

-- ── Skills ─────────────────────────────────────────────────
CREATE skill CONTENT {
    uri: "skills://pricing-bot/debug-pricing",
    version: "1.0",
    hash: "a1b2c3",
    agent_type: "pricing-bot",
    content: "# How to Debug Pricing Issues\n\n1. First check which policies are active for the transaction type\n2. Verify policy evaluation order: service_charge -> commission -> tax -> discount\n3. Check if any conditions are misconfigured (wrong channel, wrong tier)\n4. Look at recent git changes to pricing config files\n5. NEVER modify pricing configs without explicit approval\n6. Always show the before/after calculation when suggesting a fix\n7. If confidence is below 80%, escalate to human"
};

CREATE skill CONTENT {
    uri: "skills://pricing-bot/analyze-issues",
    version: "1.0",
    hash: "d4e5f6",
    agent_type: "pricing-bot",
    content: "# How to Analyze L4 Issues\n\n1. Read the Jira ticket fully\n2. Search docs for related pricing concepts\n3. Grep codebase for keywords from the ticket\n4. Read relevant source files\n5. Check git log for recent changes\n6. Provide analysis with: Summary, Root Cause, Affected Files, Impact, Suggested Fix, Confidence Level"
};

-- ── Resources ──────────────────────────────────────────────
CREATE resource CONTENT {
    uri: "docs://pricing/overview",
    version: "1.0",
    hash: "g7h8i9",
    agent_type: "pricing-bot",
    content: "# Pricing Engine Overview\n\nThe pricing engine determines fees, commissions, and taxes for mobile money transactions.\n\nPolicy evaluation order:\n1. Service Charge Policy - what the user pays\n2. Commission Policy - what the agent earns\n3. Transaction Tax Policy - government levies\n4. Discount Policy - promotional reductions\n\nEach policy has: conditions (who/what/when), calculation method (flat/percentage/tiered), and priority (evaluation order)."
};

CREATE resource CONTENT {
    uri: "docs://pricing/service-charge",
    version: "1.0",
    hash: "j0k1l2",
    agent_type: "pricing-bot",
    content: "# Service Charge Policy\n\nDefines fees charged to end-users for transactions.\n\nTypes:\n- Flat fee: fixed amount (e.g., $0.50 per txn)\n- Percentage: % of transaction amount (e.g., 1.5%)\n- Tiered: different rates based on amount ranges"
};

CREATE resource CONTENT {
    uri: "docs://pricing/commission",
    version: "1.0",
    hash: "m3n4o5",
    agent_type: "pricing-bot",
    content: "# Commission Policy\n\nDefines earnings for agents/merchants per transaction.\n\n- Source: deducted from service charge or separate pool\n- Split: Super Agent 40%, Agent 50%, Platform 10%\n- Settlement: real-time or batched (daily/weekly)\n- Clawback: reversed if transaction is disputed within 30 days"
};

-- ── Catalog ────────────────────────────────────────────────
CREATE catalog CONTENT {
    agent_type: "pricing-bot",
    version: "1.0",
    repos: [
        { url: "https://github.com/company/pricing-engine", name: "pricing-engine", branch: "main" }
    ],
    mcp_servers: [
        { name: "jira", command: "npx", args: ["-y", "@anthropic-ai/mcp-server-jira"] }
    ]
};

-- ── Test Subscription ──────────────────────────────────────
-- API key: sk_test_sda_integration_2026
-- Hash: SHA-256 of the key above
CREATE subscription CONTENT {
    customer_id: "test_customer",
    key_hash: "69bc2458e737fab726b245b2d11aaaf95ed321cdf403ae8f0ccba9c30ecb0dd3",
    plan: "pro",
    agent_types: ["pricing-bot", "kyc-bot"],
    max_agents: 10,
    status: "active",
    created_at: time::now(),
    expires_at: time::now() + 365d
};
