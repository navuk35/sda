/**
 * catalog.ts — Fetches agent catalog from the SDA backend.
 *
 * GET /api/v1/catalog/{agentType}
 * Returns: skills[], resources[], repos[], mcpServers[]
 */

export interface CatalogSkill {
  uri: string;
  version: string;
  hash: string;
}

export interface CatalogResource {
  uri: string;
  version: string;
  hash: string;
}

export interface CatalogRepo {
  url: string;
  name?: string;
  branch?: string;
}

export interface McpServer {
  name: string;
  command: string;
  args?: string[];
}

export interface AgentCatalog {
  agentType: string;
  version: string;
  skills: CatalogSkill[];
  resources: CatalogResource[];
  repos: CatalogRepo[];
  mcpServers: McpServer[];
}

export async function fetchCatalog(
  backendUrl: string,
  agentType: string,
  apiKey: string,
): Promise<AgentCatalog> {
  const response = await fetch(`${backendUrl}/api/v1/catalog/${agentType}`, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(
      `Failed to fetch catalog for ${agentType}: ${response.status} ${error.slice(0, 200)}`,
    );
  }

  const catalog = (await response.json()) as AgentCatalog;

  if (!catalog.agentType) {
    throw new Error(`Invalid catalog response: missing agentType`);
  }

  return catalog;
}

/**
 * Fetch individual skill or resource content from the backend.
 */
export async function fetchContent(
  backendUrl: string,
  uri: string,
  apiKey: string,
): Promise<{ uri: string; version: string; content: string }> {
  const response = await fetch(
    `${backendUrl}/api/v1/content/${encodeURIComponent(uri)}`,
    {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
    },
  );

  if (!response.ok) {
    throw new Error(
      `Failed to fetch content ${uri}: ${response.status}`,
    );
  }

  return response.json();
}
