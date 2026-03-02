/**
 * Sandbox Runner — Subprocess orchestration for Code Mode tools.
 *
 * Spawns isolated sandbox scripts (search-sandbox.cjs, execute-sandbox.cjs)
 * as child processes. Agent-generated code runs in vm.runInContext()
 * inside the child — no require, fs, process, or network access.
 *
 * search-sandbox: CSN model piped via stdin, results on stdout.
 * execute-sandbox: Boots CDS + SQLite in cwd, results on stdout.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import path from 'path';
import { getCompiledModel } from './cds-executor.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface SandboxResult {
  logs: string[];
  result?: any;
  queries?: Array<{ sql: string; rowCount: number }>;
  error?: string;
}

/** Resolve path to a sandbox script in mcp-server/scripts/ */
function sandboxPath(script: string): string {
  // At runtime, __dirname = mcp-server/build/; scripts live at mcp-server/scripts/
  return path.resolve(__dirname, '..', 'scripts', script);
}

/**
 * Run user code in the search sandbox (CSN model exploration).
 *
 * 1. Compiles CDS model to JSON (cached 60s via cds-executor)
 * 2. Spawns search-sandbox.cjs subprocess
 * 3. Pipes CSN to child stdin
 * 4. Collects JSON result from child stdout
 */
export async function runSearchSandbox(
  code: string,
  cwd: string,
  timeoutMs: number = 10000
): Promise<SandboxResult> {
  const csn = await getCompiledModel(cwd);
  const codeB64 = Buffer.from(code).toString('base64');

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const child = spawn(
      'node',
      [sandboxPath('search-sandbox.cjs'), codeB64, String(timeoutMs)],
      {
        cwd,
        env: { ...process.env, FORCE_COLOR: '0' },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    // Handle stdin errors (child may crash before reading all CSN)
    child.stdin.on('error', () => { /* handled by 'close' event */ });

    // Pipe compiled CSN model to child stdin
    child.stdin.write(csn);
    child.stdin.end();

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    // Parent timeout: sandbox timeout + 2s overhead for process spawn
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      if (!settled) {
        settled = true;
        reject(new Error(`Search sandbox timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs + 2000);

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      try {
        const result: SandboxResult = JSON.parse(stdout.trim());
        resolve(result);
      } catch {
        resolve({ error: stderr || `Sandbox exited with code ${exitCode}`, logs: [] });
      }
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(new Error(`Failed to spawn search sandbox: ${error.message}`));
    });
  });
}

/**
 * Run user code in the execute sandbox (SQL queries + JS transforms).
 *
 * 1. Spawns execute-sandbox.cjs subprocess (boots CDS + SQLite)
 * 2. Child loads CSV seed data into in-memory SQLite
 * 3. User code runs with query() and log() globals
 * 4. Collects JSON result from child stdout
 */
export async function runExecuteSandbox(
  code: string,
  cwd: string,
  timeoutMs: number = 30000
): Promise<SandboxResult> {
  const codeB64 = Buffer.from(code).toString('base64');

  return new Promise((resolve, reject) => {
    let stdout = '';
    let stderr = '';
    let settled = false;

    const child = spawn(
      'node',
      [sandboxPath('execute-sandbox.cjs'), codeB64, String(timeoutMs)],
      {
        cwd,
        env: { ...process.env, FORCE_COLOR: '0' },
        stdio: ['ignore', 'pipe', 'pipe'],
      }
    );

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    // Parent timeout: sandbox timeout + 5s for CDS boot overhead
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      if (!settled) {
        settled = true;
        reject(new Error(`Execute sandbox timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs + 5000);

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      try {
        const result: SandboxResult = JSON.parse(stdout.trim());
        resolve(result);
      } catch {
        resolve({ error: stderr || `Sandbox exited with code ${exitCode}`, logs: [] });
      }
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      reject(new Error(`Failed to spawn execute sandbox: ${error.message}`));
    });
  });
}
