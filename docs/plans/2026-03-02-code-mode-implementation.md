# Code Mode Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace 19 static MCP tools with 2 programmable Code Mode tools (`cap_search` + `cap_execute`) using VM-sandboxed subprocesses.

**Architecture:** Two CJS sandbox scripts (search-sandbox.cjs, execute-sandbox.cjs) run agent-generated JavaScript in `vm.runInNewContext()`. A TypeScript `sandbox-runner.ts` orchestrates subprocess lifecycle. `code-mode-tools.ts` defines 2 MCP tool schemas + handlers. `index.ts` is simplified to tools-only capability.

**Tech Stack:** Node.js `vm` module (built-in), `child_process.spawn`, `@modelcontextprotocol/sdk`, `@sap/cds`, `@cap-js/sqlite`

**Design Doc:** `docs/plans/2026-03-02-code-mode-design.md`

---

## Task 1: Create search-sandbox.cjs

**Files:**
- Create: `mcp-server/scripts/search-sandbox.cjs`

**Step 1: Write the failing test**

```bash
# Feed a minimal CSN via stdin, run code that logs table list
echo '{"definitions":{"flights.Carriers":{"kind":"entity","elements":{"CARRID":{"type":"cds.String","key":true}}},"flights.Flights":{"kind":"entity","elements":{"FLDATE":{"type":"cds.String","key":true}}}}}' | \
  node mcp-server/scripts/search-sandbox.cjs $(echo -n 'log(tables)' | base64)
```

**Step 2: Run test to verify it fails**

Run the command above.
Expected: `Error: Cannot find module` or `no such file or directory`

**Step 3: Write the implementation**

Create `mcp-server/scripts/search-sandbox.cjs`:

```javascript
#!/usr/bin/env node
/**
 * Search Sandbox — Isolated VM for cap_search tool.
 *
 * Receives compiled CSN model via stdin (JSON).
 * Receives user code via CLI arg 1 (base64-encoded).
 * Optional timeout via CLI arg 2 (ms, default: 5000).
 *
 * Sandbox globals: model (CSN), tables (string[]), log()
 * Output: JSON { logs: string[], result?: any }
 */

const vm = require('vm');

let stdinData = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => { stdinData += chunk; });
process.stdin.on('end', () => {
  try {
    const model = JSON.parse(stdinData);
    const userCode = Buffer.from(process.argv[2], 'base64').toString('utf-8');
    const maxMs = parseInt(process.argv[3] || '5000', 10);

    // Build SQL table name list from CSN definitions
    const defs = model.definitions || {};
    const tables = [];
    for (const [name, def] of Object.entries(defs)) {
      if (def.kind !== 'entity') continue;
      // Skip service projections (parent is a service)
      const parts = name.split('.');
      if (parts.length > 1) {
        const parentName = parts.slice(0, -1).join('.');
        const parent = defs[parentName];
        if (parent && parent.kind === 'service') continue;
      }
      tables.push(name.replace(/\./g, '_'));
    }

    // Collected log output
    const logs = [];
    const logFn = (...args) => {
      logs.push(
        args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a, null, 2))).join(' ')
      );
    };

    // Restricted sandbox context — no require, fs, process, fetch, eval
    const context = { model, tables, log: logFn };

    const result = vm.runInNewContext(userCode, context, {
      timeout: maxMs,
      filename: 'cap_search.js',
    });

    process.stdout.write(
      JSON.stringify({ logs, result: result !== undefined ? result : null }) + '\n'
    );
    process.exit(0);
  } catch (e) {
    process.stdout.write(JSON.stringify({ error: e.message, logs: [] }) + '\n');
    process.exit(1);
  }
});
```

**Step 4: Run test to verify it passes**

Run:
```bash
echo '{"definitions":{"flights.Carriers":{"kind":"entity","elements":{"CARRID":{"type":"cds.String","key":true}}},"flights.Flights":{"kind":"entity","elements":{"FLDATE":{"type":"cds.String","key":true}}}}}' | \
  node mcp-server/scripts/search-sandbox.cjs $(echo -n 'log(tables)' | base64)
```

Expected output (JSON):
```json
{"logs":["[\n  \"flights_Carriers\",\n  \"flights_Flights\"\n]"],"result":null}
```

Also verify sandbox security:
```bash
# Should fail — no require in sandbox
echo '{"definitions":{}}' | \
  node mcp-server/scripts/search-sandbox.cjs $(echo -n 'require("fs")' | base64)
# Expected: {"error":"require is not defined","logs":[]}

# Should fail — no process in sandbox
echo '{"definitions":{}}' | \
  node mcp-server/scripts/search-sandbox.cjs $(echo -n 'process.exit(1)' | base64)
# Expected: {"error":"process is not defined","logs":[]}

# Should fail — timeout on infinite loop
echo '{"definitions":{}}' | \
  node mcp-server/scripts/search-sandbox.cjs $(echo -n 'while(true){}' | base64) 1000
# Expected: {"error":"Script execution timed out after 1000ms","logs":[]}
```

**Step 5: Commit**

```bash
git add mcp-server/scripts/search-sandbox.cjs
git commit -m "feat: add search sandbox for cap_search Code Mode tool"
```

---

## Task 2: Create execute-sandbox.cjs

**Files:**
- Create: `mcp-server/scripts/execute-sandbox.cjs`

**Step 1: Write the failing test**

```bash
# Run from project root — boots CDS + SQLite, queries carriers
cd /Users/aks91/Development/demo/sflights-mcp && \
  node mcp-server/scripts/execute-sandbox.cjs \
    $(echo -n 'const rows = await query("SELECT CARRID, CARRNAME FROM flights_Carriers LIMIT 3"); log(rows);' | base64)
```

**Step 2: Run test to verify it fails**

Run the command above.
Expected: `Error: Cannot find module` or `no such file or directory`

**Step 3: Write the implementation**

Create `mcp-server/scripts/execute-sandbox.cjs`:

```javascript
#!/usr/bin/env node
/**
 * Execute Sandbox — Isolated VM for cap_execute tool.
 *
 * Boots CDS + SQLite in-memory from cwd, loads CSV seed data.
 * Receives user code via CLI arg 1 (base64-encoded).
 * Optional timeout via CLI arg 2 (ms, default: 10000).
 *
 * Sandbox globals: query(sql, maxRows?), log()
 * Output: JSON { logs: string[], result?: any, queries?: [{sql, rowCount}] }
 */

const vm = require('vm');

// Resolve @sap/cds from the target project's node_modules (cwd)
const cdsPath = require.resolve('@sap/cds', { paths: [process.cwd()] });
const cds = require(cdsPath);

// Suppress CDS bootstrap console.log output (pollutes stdout)
const _origLog = console.log;
let _suppressLogs = true;
console.log = (...args) => {
  if (_suppressLogs) return;
  _origLog.apply(console, args);
};

async function boot() {
  const model = await cds.load('*');
  const db = await cds.connect.to('db');
  await cds.deploy(model).to(db);
  return { db, model };
}

(async () => {
  const userCode = Buffer.from(process.argv[2], 'base64').toString('utf-8');
  const maxMs = parseInt(process.argv[3] || '10000', 10);

  const { db } = await boot();

  const logs = [];
  const queryLog = [];

  const queryFn = async (sql, maxRows = 50) => {
    const upper = sql.toUpperCase().trim();
    const isSelect = upper.startsWith('SELECT') || upper.startsWith('WITH');
    let finalSql = sql;
    if (isSelect && !upper.includes('LIMIT')) {
      finalSql = `${sql} LIMIT ${maxRows}`;
    }
    const result = await db.run(finalSql);
    const rows = Array.isArray(result) ? result : [result];
    queryLog.push({ sql: sql.trim(), rowCount: rows.length });
    return rows;
  };

  const logFn = (...args) => {
    logs.push(
      args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a, null, 2))).join(' ')
    );
  };

  // Restricted sandbox context — no require, fs, process, fetch
  const context = { query: queryFn, log: logFn };

  // Wrap in async IIFE so user code can use `await`
  const wrappedCode = `(async () => { ${userCode} })()`;
  const result = await vm.runInNewContext(wrappedCode, context, {
    timeout: maxMs,
    filename: 'cap_execute.js',
  });

  process.stdout.write(
    JSON.stringify({
      logs,
      result: result !== undefined ? result : null,
      queries: queryLog,
    }) + '\n'
  );
  process.exit(0);
})().catch((e) => {
  process.stdout.write(JSON.stringify({ error: e.message, logs: [] }) + '\n');
  process.exit(1);
});
```

**Step 4: Run test to verify it passes**

Run:
```bash
cd /Users/aks91/Development/demo/sflights-mcp && \
  node mcp-server/scripts/execute-sandbox.cjs \
    $(echo -n 'const rows = await query("SELECT CARRID, CARRNAME FROM flights_Carriers LIMIT 3"); log(rows);' | base64)
```

Expected: JSON with `logs` containing 3 carrier rows, `queries` showing the SQL.

Also verify multi-query composition:
```bash
cd /Users/aks91/Development/demo/sflights-mcp && \
  node mcp-server/scripts/execute-sandbox.cjs \
    $(echo -n 'const c = await query("SELECT COUNT(*) as cnt FROM flights_Carriers"); const f = await query("SELECT COUNT(*) as cnt FROM flights_Flights"); log("Carriers:", c[0].cnt, "Flights:", f[0].cnt);' | base64)
```

Expected: JSON with logs showing carrier and flight counts, queries array with 2 entries.

Verify sandbox security:
```bash
# Should fail — no require
cd /Users/aks91/Development/demo/sflights-mcp && \
  node mcp-server/scripts/execute-sandbox.cjs $(echo -n 'require("fs")' | base64)
# Expected: {"error":"require is not defined","logs":[]}
```

**Step 5: Commit**

```bash
git add mcp-server/scripts/execute-sandbox.cjs
git commit -m "feat: add execute sandbox for cap_execute Code Mode tool"
```

---

## Task 3: Create sandbox-runner.ts

**Files:**
- Create: `mcp-server/src/sandbox-runner.ts`

**Step 1: Write the failing test**

```bash
# Build should fail because sandbox-runner.ts doesn't exist yet
cd mcp-server && npx tsc --noEmit 2>&1 | head -5
```

(We'll import it in the next task; for now, verify the file compiles standalone.)

**Step 2: Run test to verify it fails**

N/A — this is a new standalone file. We'll verify compilation after writing it.

**Step 3: Write the implementation**

Create `mcp-server/src/sandbox-runner.ts`:

```typescript
/**
 * Sandbox Runner — Subprocess orchestration for Code Mode tools.
 *
 * Spawns isolated sandbox scripts (search-sandbox.cjs, execute-sandbox.cjs)
 * as child processes. Agent-generated code runs in vm.runInNewContext()
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

    const child = spawn(
      'node',
      [sandboxPath('search-sandbox.cjs'), codeB64, String(timeoutMs)],
      {
        cwd,
        env: { ...process.env, FORCE_COLOR: '0' },
        stdio: ['pipe', 'pipe', 'pipe'],
      }
    );

    // Pipe compiled CSN model to child stdin
    child.stdin.write(csn);
    child.stdin.end();

    child.stdout.on('data', (data) => { stdout += data.toString(); });
    child.stderr.on('data', (data) => { stderr += data.toString(); });

    // Parent timeout: sandbox timeout + 2s overhead for process spawn
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`Search sandbox timed out after ${timeoutMs}ms`));
    }, timeoutMs + 2000);

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      try {
        const result: SandboxResult = JSON.parse(stdout.trim());
        resolve(result);
      } catch {
        resolve({ error: stderr || `Sandbox exited with code ${exitCode}`, logs: [] });
      }
    });

    child.on('error', (error) => {
      clearTimeout(timer);
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
      child.kill();
      reject(new Error(`Execute sandbox timed out after ${timeoutMs}ms`));
    }, timeoutMs + 5000);

    child.on('close', (exitCode) => {
      clearTimeout(timer);
      try {
        const result: SandboxResult = JSON.parse(stdout.trim());
        resolve(result);
      } catch {
        resolve({ error: stderr || `Sandbox exited with code ${exitCode}`, logs: [] });
      }
    });

    child.on('error', (error) => {
      clearTimeout(timer);
      reject(new Error(`Failed to spawn execute sandbox: ${error.message}`));
    });
  });
}
```

**Step 4: Verify compilation**

Run:
```bash
cd mcp-server && npx tsc --noEmit src/sandbox-runner.ts 2>&1
```

Expected: No errors (or only errors from files that import sandbox-runner, which don't exist yet).

Note: A full `tsc` build will still have errors because `index.ts` still imports `cap-tools.ts` etc. That's expected — we fix index.ts in Task 5.

**Step 5: Commit**

```bash
git add mcp-server/src/sandbox-runner.ts
git commit -m "feat: add sandbox runner for subprocess orchestration"
```

---

## Task 4: Create code-mode-tools.ts

**Files:**
- Create: `mcp-server/src/code-mode-tools.ts`

**Step 1: Write the failing test**

We'll test via a full MCP JSON-RPC tools/list call after Task 5 rewires index.ts. For now, verify the module compiles and exports correctly.

```bash
cd mcp-server && npx tsc --noEmit src/code-mode-tools.ts 2>&1
```

**Step 2: Run test to verify it fails**

Expected: `error TS6053: File 'src/code-mode-tools.ts' not found`

**Step 3: Write the implementation**

Create `mcp-server/src/code-mode-tools.ts`:

```typescript
/**
 * Code Mode Tools — 2-tool MCP interface for CAP CDS exploration.
 *
 * Replaces the previous 19-tool static registry with 2 programmable tools:
 *   cap_search  — Write JavaScript to explore the compiled CDS model (CSN)
 *   cap_execute — Write JavaScript to query data and transform results
 *
 * Agent-generated code runs in VM-sandboxed subprocesses (no require, fs, network).
 * Design: docs/plans/2026-03-02-code-mode-design.md
 */

import { runSearchSandbox, runExecuteSandbox, type SandboxResult } from './sandbox-runner.js';

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, any>;
    required?: string[];
  };
  handler: (args: Record<string, any>, cwd: string) => Promise<string>;
}

/** Format sandbox result into readable text for the model. */
function formatResult(result: SandboxResult): string {
  const parts: string[] = [];

  if (result.error) {
    parts.push(`**Error:** ${result.error}`);
  }

  if (result.logs && result.logs.length > 0) {
    parts.push(result.logs.join('\n'));
  }

  if (result.result !== null && result.result !== undefined) {
    const formatted =
      typeof result.result === 'string'
        ? result.result
        : JSON.stringify(result.result, null, 2);
    if (formatted !== 'undefined' && formatted !== 'null') {
      parts.push(formatted);
    }
  }

  if (result.queries && result.queries.length > 0) {
    const summary = result.queries
      .map((q) => `  ${q.sql.substring(0, 100)}${q.sql.length > 100 ? '...' : ''} → ${q.rowCount} rows`)
      .join('\n');
    parts.push(`\n_Queries executed:_\n${summary}`);
  }

  return parts.join('\n') || '(no output)';
}

const capSearch: ToolDefinition = {
  name: 'cap_search',
  description: `Explore the CDS data model by writing JavaScript that runs against the compiled schema (CSN).

**Sandbox globals:**
- \`model\` — Full CSN object. \`model.definitions\` maps entity names to their structure.
- \`tables\` — Array of SQL table names (e.g., "flights_Carriers").
- \`log(...args)\` — Output results (like console.log). Always log your findings.

**Example — list all entities with their key fields:**
\`\`\`javascript
for (const [name, def] of Object.entries(model.definitions)) {
  if (def.kind !== 'entity') continue;
  const keys = Object.entries(def.elements || {})
    .filter(([, e]) => e.key)
    .map(([n]) => n);
  log(name, '→ keys:', keys.join(', '));
}
\`\`\`

**Tips:**
- Entity elements have: .type, .key, .length, .target (for associations)
- Association elements have: .type = "cds.Association", .target, .on (join conditions)
- Service projections reference base entities — check \`def.projection\`
- Start with \`log(tables)\` to see all available SQL tables`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      code: {
        type: 'string',
        description:
          'JavaScript code to execute in the search sandbox. Use log() to output results.',
      },
    },
    required: ['code'],
  },
  handler: async (args, cwd) => {
    const result = await runSearchSandbox(args.code, cwd);
    return formatResult(result);
  },
};

const capExecute: ToolDefinition = {
  name: 'cap_execute',
  description: `Run SQL queries and JavaScript transforms against the CAP project's data (in-memory SQLite with all CSV seed data loaded).

**Sandbox globals:**
- \`query(sql, maxRows?)\` — Execute SQL, returns array of row objects. Default maxRows: 50.
- \`log(...args)\` — Output results. Always log your findings.

**Example — top airlines by flight count:**
\`\`\`javascript
const rows = await query(\`
  SELECT c.CARRNAME, COUNT(*) as flight_count
  FROM flights_Flights f
  JOIN flights_Carriers c ON c.MANDT = f.MANDT AND c.CARRID = f.CARRID
  GROUP BY c.CARRNAME
  ORDER BY flight_count DESC
  LIMIT 10
\`);
log(rows);
\`\`\`

**Key tables:** flights_Carriers, flights_Connections, flights_Flights, flights_Bookings, flights_Customers, flights_Planes, flights_Airports, flights_TravelAgencies, flights_Tickets

**Common JOINs:**
- Carrier→Flights: \`c.MANDT=f.MANDT AND c.CARRID=f.CARRID\`
- Connection→Flights: \`cn.MANDT=f.MANDT AND cn.CARRID=f.CARRID AND cn.CONNID=f.CONNID\`
- Flight→Bookings: \`f.MANDT=b.MANDT AND f.CARRID=b.CARRID AND f.CONNID=b.CONNID AND f.FLDATE=b.FLDATE\`

**Tips:**
- Use \`await\` with query() — it's async
- Multiple queries allowed — build results incrementally
- SQLite dialect: use \`substr()\`, \`strftime()\`, \`CAST()\`
- Pre-joined views available: flights_FlightSchedule, flights_BookingDetails`,
  inputSchema: {
    type: 'object' as const,
    properties: {
      code: {
        type: 'string',
        description:
          'JavaScript code to execute. Use await query(sql) for data and log() for output.',
      },
    },
    required: ['code'],
  },
  handler: async (args, cwd) => {
    const result = await runExecuteSandbox(args.code, cwd);
    return formatResult(result);
  },
};

export const ALL_TOOLS: ToolDefinition[] = [capSearch, capExecute];
```

**Step 4: Verify compilation**

Run:
```bash
cd mcp-server && npx tsc --noEmit src/code-mode-tools.ts 2>&1
```

Expected: No errors.

**Step 5: Commit**

```bash
git add mcp-server/src/code-mode-tools.ts
git commit -m "feat: add cap_search and cap_execute Code Mode tool definitions"
```

---

## Task 5: Rewrite index.ts (tools-only)

**Files:**
- Modify: `mcp-server/src/index.ts`

**Step 1: Write the failing test**

After rewriting, the MCP server should list exactly 2 tools:

```bash
cd /Users/aks91/Development/demo/sflights-mcp && \
  echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | \
  node mcp-server/build/index.js 2>/dev/null | head -1
```

**Step 2: Run test to verify current state**

Run the command above with the CURRENT server (before changes).
Expected: Returns 19 tools (current state — will change to 2 after this task).

Note: We need to build first after previous tasks. Run `cd mcp-server && npm run build` before testing.

**Step 3: Rewrite index.ts**

Replace the full contents of `mcp-server/src/index.ts` with:

```typescript
#!/usr/bin/env node

/**
 * CAP CDS MCP Server — Code Mode
 *
 * 2-tool MCP server: cap_search (model exploration) + cap_execute (data queries).
 * Agent-generated JavaScript runs in VM-sandboxed subprocesses.
 *
 * Design: docs/plans/2026-03-02-code-mode-design.md
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { ALL_TOOLS, type ToolDefinition } from './code-mode-tools.js';

class CapMcpServer {
  private server: Server;
  private tools: Map<string, ToolDefinition> = new Map();
  private projectRoot: string;

  constructor() {
    this.projectRoot = process.env.CAP_PROJECT_ROOT || process.cwd();

    this.server = new Server(
      {
        name: 'cap-mcp-server',
        version: '2.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.registerTools();
    this.setupHandlers();
    this.setupErrorHandling();
  }

  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      console.error('[CAP MCP Error]', error);
    };

    process.on('SIGINT', async () => {
      await this.server.close();
      process.exit(0);
    });
  }

  private registerTools(): void {
    for (const tool of ALL_TOOLS) {
      this.tools.set(tool.name, tool);
    }
    console.error(`[CAP MCP] Registered ${this.tools.size} tools`);
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: Array.from(this.tools.values()).map((tool) => ({
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        })),
      };
    });

    // Execute tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      const tool = this.tools.get(name);
      if (!tool) {
        return {
          content: [
            {
              type: 'text' as const,
              text: `Unknown tool: ${name}. Available: ${Array.from(this.tools.keys()).join(', ')}`,
            },
          ],
        };
      }

      try {
        const cwd = (args as Record<string, any>)?.projectRoot || this.projectRoot;
        const result = await tool.handler((args as Record<string, any>) || {}, cwd);

        return {
          content: [{ type: 'text' as const, text: result }],
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text' as const,
              text: `Error executing ${name}: ${message}`,
            },
          ],
        };
      }
    });
  }

  async run(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    console.error(`[CAP MCP] Server running on stdio (Code Mode)`);
    console.error(`[CAP MCP] Project root: ${this.projectRoot}`);
    console.error(`[CAP MCP] Tools: ${Array.from(this.tools.keys()).join(', ')}`);
  }
}

const server = new CapMcpServer();
server.run().catch((error) => {
  console.error('[CAP MCP] Fatal error:', error);
  process.exit(1);
});
```

**Step 4: Build and verify**

Run:
```bash
cd mcp-server && npm run build 2>&1 | tail -5
```

Expected: Build succeeds (may warn about unused files we'll delete in Task 6 — that's fine).

Then test the tools/list response:
```bash
cd /Users/aks91/Development/demo/sflights-mcp && \
  echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | \
  node mcp-server/build/index.js 2>/dev/null | head -1 | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['result']['tools']), 'tools:', [t['name'] for t in d['result']['tools']])"
```

Expected: `2 tools: ['cap_search', 'cap_execute']`

**Step 5: Commit**

```bash
git add mcp-server/src/index.ts
git commit -m "feat: rewrite index.ts for Code Mode (tools-only, 2 tools)"
```

---

## Task 6: Delete old files

**Files:**
- Delete: `mcp-server/src/cap-tools.ts`
- Delete: `mcp-server/src/cap-resources.ts`
- Delete: `mcp-server/src/cap-prompts.ts`
- Delete: `mcp-server/src/output-formatter.ts`

**Step 1: Verify no imports remain**

```bash
cd mcp-server && grep -r "cap-tools\|cap-resources\|cap-prompts\|output-formatter" src/ --include="*.ts" | grep -v "\.ts:" | head
```

Expected: No matches from `index.ts`, `code-mode-tools.ts`, or `sandbox-runner.ts`. (Only matches should be the files themselves.)

More precise check — only non-self references:
```bash
grep -rn "from.*cap-tools\|from.*cap-resources\|from.*cap-prompts\|from.*output-formatter" mcp-server/src/ --include="*.ts"
```

Expected: No output (the new index.ts imports from `code-mode-tools.js`, not the old files).

**Step 2: Delete the files**

```bash
cd mcp-server && rm src/cap-tools.ts src/cap-resources.ts src/cap-prompts.ts src/output-formatter.ts
```

**Step 3: Rebuild and verify**

```bash
cd mcp-server && npm run build 2>&1
```

Expected: Clean build with no errors.

Verify tools still work:
```bash
cd /Users/aks91/Development/demo/sflights-mcp && \
  echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | \
  node mcp-server/build/index.js 2>/dev/null | head -1 | python3 -c "import sys,json; d=json.load(sys.stdin); print(len(d['result']['tools']), 'tools')"
```

Expected: `2 tools`

**Step 4: Commit**

```bash
git add -u mcp-server/src/
git commit -m "refactor: remove 19 legacy tools, resources, and prompts"
```

---

## Task 7: End-to-end MCP protocol tests

**Files:**
- Create: `test/mcp-code-mode-test.sh`

**Step 1: Write the test script**

Create `test/mcp-code-mode-test.sh`:

```bash
#!/usr/bin/env bash
# End-to-end tests for Code Mode MCP server (2 tools: cap_search, cap_execute)
# Run from project root: bash test/mcp-code-mode-test.sh

set -euo pipefail

SERVER="node mcp-server/build/index.js"
PASS=0
FAIL=0

send() {
  echo "$1" | $SERVER 2>/dev/null | head -1
}

check() {
  local name="$1" expected="$2" actual="$3"
  if echo "$actual" | grep -q "$expected"; then
    echo "  PASS: $name"
    ((PASS++))
  else
    echo "  FAIL: $name (expected '$expected')"
    echo "    got: $(echo "$actual" | head -c 200)"
    ((FAIL++))
  fi
}

echo "=== Code Mode MCP Tests ==="
echo ""

# Test 1: tools/list returns exactly 2 tools
echo "1. tools/list"
RESULT=$(send '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')
check "returns cap_search" "cap_search" "$RESULT"
check "returns cap_execute" "cap_execute" "$RESULT"

# Test 2: cap_search — list tables
echo "2. cap_search — list tables"
CODE=$(echo -n 'log(tables.length + " tables"); log(tables.slice(0,3))' | base64)
RESULT=$(send "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"tools/call\",\"params\":{\"name\":\"cap_search\",\"arguments\":{\"code\":\"$(echo -n 'log(tables.length + \" tables\"); log(tables.slice(0,3))' | base64 | xargs -I{} echo -n '{}')\"}}}") || true
# Simplified: just call with inline code
RESULT=$(echo '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"cap_search","arguments":{"code":"log(tables.length + \" tables\")"}}}' | $SERVER 2>/dev/null | head -1)
check "returns table count" "tables" "$RESULT"

# Test 3: cap_execute — simple query
echo "3. cap_execute — carrier count"
RESULT=$(echo '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"cap_execute","arguments":{"code":"const r = await query(\"SELECT COUNT(*) as cnt FROM flights_Carriers\"); log(\"Carriers: \" + r[0].cnt);"}}}' | $SERVER 2>/dev/null | head -1)
check "returns carrier count" "Carriers:" "$RESULT"

# Test 4: cap_search — sandbox security (no require)
echo "4. cap_search — sandbox blocks require()"
RESULT=$(echo '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"cap_search","arguments":{"code":"require(\"fs\")"}}}' | $SERVER 2>/dev/null | head -1)
check "blocks require" "not defined" "$RESULT"

# Test 5: cap_execute — sandbox security (no process)
echo "5. cap_execute — sandbox blocks process"
RESULT=$(echo '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"cap_execute","arguments":{"code":"process.exit(1)"}}}' | $SERVER 2>/dev/null | head -1)
check "blocks process" "not defined" "$RESULT"

# Test 6: cap_execute — multi-query composition
echo "6. cap_execute — multi-query composition"
RESULT=$(echo '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"cap_execute","arguments":{"code":"const c = await query(\"SELECT COUNT(*) as n FROM flights_Carriers\"); const f = await query(\"SELECT COUNT(*) as n FROM flights_Flights\"); log(\"carriers=\" + c[0].n + \" flights=\" + f[0].n);"}}}' | $SERVER 2>/dev/null | head -1)
check "multi-query returns data" "carriers=" "$RESULT"
check "multi-query has flights" "flights=" "$RESULT"

# Test 7: Unknown tool returns error
echo "7. Unknown tool"
RESULT=$(send '{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"cap_nonexistent","arguments":{}}}')
check "unknown tool error" "Unknown tool" "$RESULT"

echo ""
echo "=== Results: $PASS passed, $FAIL failed ==="
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
```

**Step 2: Run the test script**

```bash
bash test/mcp-code-mode-test.sh
```

Expected: All tests pass.

**Step 3: Commit**

```bash
git add test/mcp-code-mode-test.sh
git commit -m "test: add end-to-end Code Mode MCP test suite"
```

---

## Task 8: Final verification and cleanup

**Step 1: Full rebuild from clean state**

```bash
cd mcp-server && rm -rf build && npm run build 2>&1
```

Expected: Clean build, no errors.

**Step 2: Verify file structure**

```bash
echo "=== Source files ===" && ls -la mcp-server/src/*.ts
echo "=== Script files ===" && ls -la mcp-server/scripts/*.cjs
echo "=== Build output ===" && ls -la mcp-server/build/*.js
```

Expected source files (4 only):
- `index.ts`
- `code-mode-tools.ts`
- `sandbox-runner.ts`
- `cds-executor.ts`

Expected scripts (3):
- `query-runner.cjs` (kept — still used by execute-sandbox internally if needed)
- `search-sandbox.cjs` (new)
- `execute-sandbox.cjs` (new)

**Step 3: Run full test suite**

```bash
bash test/mcp-code-mode-test.sh
```

Expected: All tests pass.

**Step 4: Test sandbox scripts directly**

```bash
# search-sandbox: explore model
echo '{"definitions":{"flights.Carriers":{"kind":"entity","elements":{"CARRID":{"type":"cds.String","key":true},"CARRNAME":{"type":"cds.String"}}}}}' | \
  node mcp-server/scripts/search-sandbox.cjs $(echo -n 'const entities = Object.entries(model.definitions).filter(([,d]) => d.kind === "entity"); log(entities.length + " entities")' | base64)

# execute-sandbox: query real data
cd /Users/aks91/Development/demo/sflights-mcp && \
  node mcp-server/scripts/execute-sandbox.cjs \
    $(echo -n 'const rows = await query("SELECT CARRID, CARRNAME FROM flights_Carriers ORDER BY CARRID LIMIT 5"); log(rows);' | base64)
```

Expected: Both produce valid JSON output.

**Step 5: Commit final state**

```bash
git add -A
git status  # Review — should only show test updates, no unexpected files
git commit -m "chore: final verification of Code Mode MCP conversion"
```

---

## Summary of Changes

| Action | File | Purpose |
|--------|------|---------|
| **CREATE** | `mcp-server/scripts/search-sandbox.cjs` | VM sandbox for cap_search |
| **CREATE** | `mcp-server/scripts/execute-sandbox.cjs` | VM sandbox for cap_execute |
| **CREATE** | `mcp-server/src/sandbox-runner.ts` | Subprocess orchestration |
| **CREATE** | `mcp-server/src/code-mode-tools.ts` | 2 tool definitions + handlers |
| **CREATE** | `test/mcp-code-mode-test.sh` | End-to-end test suite |
| **REWRITE** | `mcp-server/src/index.ts` | Tools-only server (v2.0.0) |
| **DELETE** | `mcp-server/src/cap-tools.ts` | Replaced by code-mode-tools.ts |
| **DELETE** | `mcp-server/src/cap-resources.ts` | Discovery via cap_search |
| **DELETE** | `mcp-server/src/cap-prompts.ts` | Workflows via SKILL.md |
| **DELETE** | `mcp-server/src/output-formatter.ts` | Formatting now in sandbox |
| **KEEP** | `mcp-server/src/cds-executor.ts` | CSN cache + CDS compile |
| **KEEP** | `mcp-server/scripts/query-runner.cjs` | SQLite query engine |
