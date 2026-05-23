OPTION IMPORT;
-- ============================================================
-- SDA — Server Driven Agents schema
-- Run with:
-- surreal import --endpoint http://localhost:8000 --namespace sda --database agents db/schema.surql
-- ============================================================

-- ── Agent Catalogs ─────────────────────────────────────────
DEFINE TABLE OVERWRITE catalog SCHEMALESS;

-- ── Skills (HOW the agent behaves) ─────────────────────────
DEFINE TABLE OVERWRITE skill SCHEMAFULL;
DEFINE FIELD OVERWRITE uri ON skill TYPE string;
DEFINE FIELD OVERWRITE version ON skill TYPE string;
DEFINE FIELD OVERWRITE hash ON skill TYPE string;
DEFINE FIELD OVERWRITE content ON skill TYPE string;
DEFINE FIELD OVERWRITE agent_type ON skill TYPE string;

-- ── Resources (WHAT the agent knows) ───────────────────────
DEFINE TABLE OVERWRITE resource SCHEMAFULL;
DEFINE FIELD OVERWRITE uri ON resource TYPE string;
DEFINE FIELD OVERWRITE version ON resource TYPE string;
DEFINE FIELD OVERWRITE hash ON resource TYPE string;
DEFINE FIELD OVERWRITE content ON resource TYPE string;
DEFINE FIELD OVERWRITE agent_type ON resource TYPE string;

-- ── Subscriptions & Auth ───────────────────────────────────
DEFINE TABLE OVERWRITE subscription SCHEMAFULL;
DEFINE FIELD OVERWRITE customer_id ON subscription TYPE string;
DEFINE FIELD OVERWRITE key_hash ON subscription TYPE string;
DEFINE FIELD OVERWRITE plan ON subscription TYPE string;
DEFINE FIELD OVERWRITE agent_types ON subscription TYPE array;
DEFINE FIELD OVERWRITE max_agents ON subscription TYPE int;
DEFINE FIELD OVERWRITE status ON subscription TYPE string;
DEFINE FIELD OVERWRITE created_at ON subscription TYPE datetime;
DEFINE FIELD OVERWRITE expires_at ON subscription TYPE option<datetime>;
DEFINE INDEX OVERWRITE idx_key_hash ON subscription FIELDS key_hash UNIQUE;

-- ── Sessions (conversation streaming) ──────────────────────
DEFINE TABLE OVERWRITE session SCHEMAFULL;
DEFINE FIELD OVERWRITE session_id ON session TYPE string;
DEFINE FIELD OVERWRITE agent_type ON session TYPE string;
DEFINE FIELD OVERWRITE user_id ON session TYPE option<string>;
DEFINE FIELD OVERWRITE status ON session TYPE string;
DEFINE FIELD OVERWRITE created_at ON session TYPE datetime;
DEFINE FIELD OVERWRITE updated_at ON session TYPE datetime;

DEFINE TABLE OVERWRITE turn SCHEMALESS;
