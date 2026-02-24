/**
 * CDS Execution Engine — Hybrid Strategy
 *
 * In-process:  `executeCds()` — calls `npx cds compile` via child process but
 *              captures stdout directly (fast, no ASCII table parsing needed).
 *
 * Shell out:   `executeShell()` — runs arbitrary shell commands for build/deploy
 *              operations that are long-running or need full environment.
 */

import { spawn } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';

export interface ExecutionResult {
  success: boolean;
  output: string;
  error?: string;
}

/**
 * In-memory CSN cache with TTL.
 * Avoids re-compiling the CDS model on every tool call within a session.
 * Cache key is the project root path; invalidated after 60s.
 */
const csnCache = new Map<string, { json: string; timestamp: number }>();
const CSN_CACHE_TTL_MS = 60_000; // 60 seconds

export function getCachedCsn(cwd: string): string | null {
  const entry = csnCache.get(cwd);
  if (entry && Date.now() - entry.timestamp < CSN_CACHE_TTL_MS) {
    return entry.json;
  }
  csnCache.delete(cwd);
  return null;
}

export function setCachedCsn(cwd: string, json: string): void {
  csnCache.set(cwd, { json, timestamp: Date.now() });
}

export function clearCsnCache(cwd?: string): void {
  if (cwd) {
    csnCache.delete(cwd);
  } else {
    csnCache.clear();
  }
}

/**
 * Resolve the cds CLI binary path.
 * Prefers local node_modules/.bin/cds, falls back to global nvm path, then 'npx cds'.
 */
function resolveCdsBinary(cwd: string): string {
  // 1. Local project binary (fastest — no npx resolution)
  const localBin = join(cwd, 'node_modules', '.bin', 'cds');
  if (existsSync(localBin)) return localBin;

  // 2. Global nvm binary (known location on this machine)
  const globalBin = process.env.CDS_BIN || join(
    process.env.HOME || '/Users/aks91',
    '.nvm/versions/node/v24.13.0/bin/cds'
  );
  if (existsSync(globalBin)) return globalBin;

  // 3. Fallback to npx (slow but always works)
  return 'npx cds';
}

/**
 * Auto-detect CDS model entry points in a project.
 * Returns paths like 'db/' and 'srv/' that contain .cds files.
 */
function detectModelSources(cwd: string): string[] {
  const sources: string[] = [];

  // Check common CAP project directories
  const candidates = ['srv/', 'db/', 'app/'];
  for (const dir of candidates) {
    if (existsSync(join(cwd, dir))) {
      sources.push(dir);
    }
  }

  // Fallback: check for root-level .cds files
  if (sources.length === 0) {
    if (existsSync(join(cwd, 'schema.cds'))) sources.push('schema.cds');
    if (existsSync(join(cwd, 'service.cds'))) sources.push('service.cds');
  }

  return sources;
}

/**
 * Execute a CDS CLI command and capture its stdout.
 * Used for in-process-like introspection (compile, env, etc.)
 *
 * For 'compile' commands without an explicit source, auto-detects model files
 * so that stdin is never needed (critical when running under MCP stdio transport).
 *
 * @param command - CDS subcommand (e.g., 'compile', 'env', 'build')
 * @param args - Additional arguments
 * @param cwd - Working directory (the CAP project root)
 * @param timeoutMs - Timeout in milliseconds (default: 30s)
 */
export async function executeCds(
  command: string,
  args: string[] = [],
  cwd: string,
  timeoutMs: number = 30000
): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    // For compile commands, ensure we always pass model sources so CDS
    // never tries to read from stdin (which is owned by MCP transport).
    // We check if a source file/dir appears BEFORE the first flag (--to, etc.)
    let finalArgs = [...args];
    if (command === 'compile') {
      const firstFlagIdx = args.findIndex((a) => a.startsWith('-'));
      const positionalsBefore = firstFlagIdx === -1 ? args : args.slice(0, firstFlagIdx);
      const hasSource = positionalsBefore.length > 0;
      if (!hasSource) {
        const sources = detectModelSources(cwd);
        if (sources.length > 0) {
          finalArgs = [...sources, ...args];
        }
      }
    }

    // Resolve the fastest available cds binary
    const cdsBin = resolveCdsBinary(cwd);

    // CRITICAL: Redirect stdin from /dev/null via shell to prevent cds compile
    // from reading MCP's stdin pipe. Node's stdio:'ignore' doesn't fully work
    // because npx/cds-dk internally creates ReadStreams.
    const fullCmd = `${cdsBin} ${command} ${finalArgs.join(' ')} < /dev/null`;
    const child = spawn('sh', ['-c', fullCmd], {
      cwd,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`CDS command timeout after ${timeoutMs}ms: cds ${command} ${finalArgs.join(' ')}`));
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(stdout);
      } else {
        reject(new Error(`CDS command failed (exit ${code}): ${stderr || stdout}`));
      }
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`Failed to spawn CDS: ${error.message}`));
    });
  });
}

/**
 * Compile the CDS model to JSON (CSN) with caching.
 * First checks the in-memory cache (60s TTL), only shells out on cache miss.
 * All model introspection tools should use this instead of calling executeCds directly.
 */
export async function getCompiledModel(cwd: string): Promise<string> {
  const cached = getCachedCsn(cwd);
  if (cached) return cached;

  const csn = await executeCds('compile', ['--to', 'json'], cwd);
  setCachedCsn(cwd, csn);
  return csn;
}

/**
 * Execute a generic shell command and capture its output.
 * Used for build/deploy ops, file inspection, curl queries, etc.
 *
 * @param command - Full shell command string
 * @param cwd - Working directory
 * @param timeoutMs - Timeout in milliseconds (default: 60s for builds)
 */
export async function executeShell(
  command: string,
  cwd: string,
  timeoutMs: number = 60000
): Promise<string> {
  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';

    const child = spawn('sh', ['-c', command], {
      cwd,
      env: { ...process.env, FORCE_COLOR: '0' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error(`Shell command timeout after ${timeoutMs}ms: ${command}`));
    }, timeoutMs);

    child.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve(stdout);
      } else {
        // For non-zero exits, still resolve with whatever output we got
        resolve(stdout || stderr || `Command exited with code ${code}`);
      }
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      reject(new Error(`Shell command failed: ${error.message}`));
    });
  });
}
