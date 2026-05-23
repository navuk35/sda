/**
 * sandbox.ts — In-process sandbox provider for SDA
 *
 * Each session gets an isolated workspace directory.
 * Agent runs as a child process in the workspace.
 */

import { execSync, exec } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SBX_BASE = "/tmp/sda-sandboxes";

export interface SandboxInstance {
  sessionId: string;
  workspaceDir: string;
}

export async function createSandbox(sessionId: string, agentType: string): Promise<SandboxInstance> {
  const workspaceDir = join(SBX_BASE, sessionId);
  mkdirSync(workspaceDir, { recursive: true });
  mkdirSync(join(workspaceDir, ".pi", "skills"), { recursive: true });
  mkdirSync(join(workspaceDir, "docs"), { recursive: true });

  console.log(`[SDA] Sandbox created in: ${workspaceDir}`);
  return { sessionId, workspaceDir };
}

export function writeSandboxFile(sandbox: SandboxInstance, path: string, content: string): void {
  const fullPath = join(sandbox.workspaceDir, path);
  const dir = join(fullPath, "..");
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(fullPath, content, "utf-8");
}

export function destroySandbox(sandbox: SandboxInstance): void {
  try { rmSync(sandbox.workspaceDir, { recursive: true, force: true }); } catch {}
}

export function getRunnerScript(): string {
  return readFileSync(
    join(import.meta.dirname, "..", "..", "agent-runner", "src", "runner-agent.cjs"),
    "utf-8",
  );
}
