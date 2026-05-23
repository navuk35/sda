/**
 * boot.ts — Agent boot sequence.
 *
 * Transforms a generic agent binary into a domain-specific agent:
 *   0. Validate API key with backend
 *   1. Fetch catalog for agentType
 *   2. Write skills to .claude/skills/
 *   3. Write resources to docs/
 *   4. Clone repositories to src/
 *   5. Return catalog for session creation
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  fetchCatalog,
  fetchContent,
  type AgentCatalog,
} from "./catalog.js";

export interface BootOptions {
  backendUrl: string;
  agentType: string;
  apiKey: string;
  workspaceDir: string;
}

export interface BootResult {
  catalog: AgentCatalog;
  skillsDir: string;
  resourcesDir: string;
  reposDir: string;
  bootTimeMs: number;
}

function verifyHash(content: string, expectedHash: string, label: string): void {
  const actual = createHash("sha256").update(content).digest("hex").slice(0, 12);
  if (actual !== expectedHash) {
    console.warn(`  ⚠ Hash mismatch for ${label}: expected ${expectedHash}, got ${actual}`);
  }
}

/**
 * Create directory if missing.
 */
function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/**
 * Write a skill fetched from the backend to the local filesystem.
 * Skills go to .claude/skills/ — the standard Claude Code / Pi location.
 */
async function writeSkill(
  backendUrl: string,
  skill: { uri: string; version: string; hash: string },
  apiKey: string,
  skillsDir: string,
): Promise<string> {
  const { content } = await fetchContent(backendUrl, skill.uri, apiKey);
  verifyHash(content, skill.hash, `skill ${skill.uri}`);

  // Derive filename from URI: skills://pricing-bot/debug-pricing → debug-pricing.md
  const name = skill.uri.split("/").pop() || skill.uri;
  const filePath = join(skillsDir, `${name}.md`);
  writeFileSync(filePath, content, "utf-8");
  console.log(`  ✓ skill: ${name}@${skill.version}`);
  return filePath;
}

/**
 * Write a resource fetched from the backend to the local filesystem.
 * Resources go to docs/ — separated from skills for classification.
 */
async function writeResource(
  backendUrl: string,
  resource: { uri: string; version: string; hash: string },
  apiKey: string,
  resourcesDir: string,
): Promise<string> {
  const { content } = await fetchContent(backendUrl, resource.uri, apiKey);
  verifyHash(content, resource.hash, `resource ${resource.uri}`);

  // Derive path from URI: docs://pricing/overview → pricing/overview.md
  const relPath = resource.uri.replace(/^docs:\/\//, "");
  const filePath = join(resourcesDir, `${relPath}.md`);
  const parentDir = join(filePath, "..");
  ensureDir(parentDir);
  writeFileSync(filePath, content, "utf-8");
  console.log(`  ✓ resource: ${relPath}@${resource.version}`);
  return filePath;
}

/**
 * Clone a git repository into the workspace.
 * Uses shallow clone for speed.
 */
function cloneRepo(
  repo: { url: string; name?: string; branch?: string },
  reposDir: string,
): void {
  const name = repo.name || repo.url.split("/").pop()?.replace(".git", "") || "repo";
  const targetDir = join(reposDir, name);

  if (existsSync(targetDir)) {
    console.log(`  ↻ repo: ${name} (already exists, pulling)`);
    execSync(`git -C "${targetDir}" pull --ff-only`, { stdio: "pipe" });
    return;
  }

  const branch = repo.branch || "main";
  console.log(`  ↓ repo: ${name} (${branch})`);
  execSync(
    `git clone --depth 1 --branch "${branch}" "${repo.url}" "${targetDir}"`,
    { stdio: "pipe", timeout: 60_000 },
  );
}

/**
 * Main boot sequence.
 */
export async function boot(options: BootOptions): Promise<BootResult> {
  const startTime = Date.now();
  const { backendUrl, agentType, apiKey, workspaceDir } = options;

  console.log(`\n[SDA] Booting agent: ${agentType}`);
  console.log(`[SDA] Backend: ${backendUrl}`);

  // Step 0: Validate API key
  console.log(`[SDA] Validating API key...`);
  const authResponse = await fetch(`${backendUrl}/api/v1/auth/validate`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!authResponse.ok) {
    throw new Error(`Authentication failed: ${authResponse.status}`);
  }
  console.log(`  ✓ Authenticated`);

  // Step 1: Fetch catalog
  console.log(`[SDA] Fetching catalog...`);
  const catalog = await fetchCatalog(backendUrl, agentType, apiKey);
  console.log(
    `  ✓ Catalog v${catalog.version}: ${catalog.skills.length} skills, ${catalog.resources.length} resources, ${catalog.repos.length} repos`,
  );

  // Step 2: Write skills
  const skillsDir = join(workspaceDir, ".claude", "skills");
  ensureDir(skillsDir);
  console.log(`[SDA] Writing skills...`);
  for (const skill of catalog.skills) {
    await writeSkill(backendUrl, skill, apiKey, skillsDir);
  }

  // Step 3: Write resources
  const resourcesDir = join(workspaceDir, "docs");
  ensureDir(resourcesDir);
  console.log(`[SDA] Writing resources...`);
  for (const resource of catalog.resources) {
    await writeResource(backendUrl, resource, apiKey, resourcesDir);
  }

  // Step 4: Clone repos
  const reposDir = join(workspaceDir, "src");
  ensureDir(reposDir);
  console.log(`[SDA] Cloning repositories...`);
  for (const repo of catalog.repos) {
    cloneRepo(repo, reposDir);
  }

  const bootTimeMs = Date.now() - startTime;
  console.log(`[SDA] Boot complete in ${(bootTimeMs / 1000).toFixed(1)}s\n`);

  return { catalog, skillsDir, resourcesDir, reposDir, bootTimeMs };
}
