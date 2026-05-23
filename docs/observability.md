# Observability: OpenTelemetry (Zero Code)

## Overview

Pi Agent SDK has **built-in OpenTelemetry instrumentation**. No code changes needed -- just set environment variables in the agent's Docker container and traces, metrics, and logs are exported automatically.

## Enable via Environment Variables

```bash
# Master switches
CLAUDE_CODE_ENABLE_TELEMETRY=1
CLAUDE_CODE_ENHANCED_TELEMETRY_BETA=1

# Export all three signals
OTEL_TRACES_EXPORTER=otlp
OTEL_METRICS_EXPORTER=otlp
OTEL_LOGS_EXPORTER=otlp

# Collector endpoint
OTEL_EXPORTER_OTLP_PROTOCOL=grpc
OTEL_EXPORTER_OTLP_ENDPOINT=https://ingest.<region>.signoz.cloud:443
OTEL_EXPORTER_OTLP_HEADERS="signoz-ingestion-key=<your-key>"

# Identity
OTEL_SERVICE_NAME=pricing-bot
OTEL_RESOURCE_ATTRIBUTES="service.version=1.0,deployment.environment=production"
```

## What Gets Auto-Traced

```
claude_code.interaction              (one agent turn)
  ├── claude_code.llm_request        (each LLM API call)
  │     → model, tokens, latency, cache hits, stop reason
  ├── claude_code.tool               (each tool invocation)
  │     ├── .blocked_on_user         (permission wait time)
  │     └── .execution               (actual execution time)
  └── claude_code.hook               (hook executions)
```

## Auto-Collected Metrics

| Metric | What |
|--------|------|
| `claude_code.token.usage` | Input, output, cache read, cache creation tokens |
| `claude_code.cost.usage` | Cost in USD |
| `claude_code.session.count` | Active sessions |
| `claude_code.active_time.total` | Time agent is actively processing |

## Content Controls (Optional)

| Variable | What it adds |
|----------|-------------|
| `OTEL_LOG_USER_PROMPTS=1` | User prompt text in spans |
| `OTEL_LOG_TOOL_DETAILS=1` | Tool arguments (file paths, commands) |
| `OTEL_LOG_TOOL_CONTENT=1` | Full tool input/output (truncated at 60KB) |

## Docker Compose (Agent Container)

```yaml
pricing-agent:
  image: sda-agent:latest
  environment:
    AGENT_TYPE: "pricing-bot"
    BACKEND_URL: "http://sda-backend:3000"
    SDA_API_KEY_ENCRYPTED: "${SDA_API_KEY_ENCRYPTED}"
    SDA_ENCRYPTION_KEY: "${SDA_ENCRYPTION_KEY}"
    CLAUDE_CODE_ENABLE_TELEMETRY: "1"
    CLAUDE_CODE_ENHANCED_TELEMETRY_BETA: "1"
    OTEL_TRACES_EXPORTER: "otlp"
    OTEL_METRICS_EXPORTER: "otlp"
    OTEL_LOGS_EXPORTER: "otlp"
    OTEL_EXPORTER_OTLP_PROTOCOL: "grpc"
    OTEL_EXPORTER_OTLP_ENDPOINT: "${SIGNOZ_ENDPOINT}"
    OTEL_EXPORTER_OTLP_HEADERS: "signoz-ingestion-key=${SIGNOZ_KEY}"
    OTEL_SERVICE_NAME: "pricing-bot"
```

## Why This Fits SDA

Agent is a dumb shell -- observability is just config, not code. Same binary, different `OTEL_SERVICE_NAME` per agent type. All traces flow to one SigNoz dashboard.
