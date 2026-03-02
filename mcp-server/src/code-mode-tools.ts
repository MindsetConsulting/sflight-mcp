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
    let formatted: string;
    try {
      formatted =
        typeof result.result === 'string'
          ? result.result
          : JSON.stringify(result.result, null, 2);
    } catch {
      formatted = String(result.result);
    }
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
    const code = args.code;
    if (typeof code !== 'string' || code.trim().length === 0) {
      return '**Error:** The `code` parameter is required and must be a non-empty string.';
    }
    const result = await runSearchSandbox(code, cwd);
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
    const code = args.code;
    if (typeof code !== 'string' || code.trim().length === 0) {
      return '**Error:** The `code` parameter is required and must be a non-empty string.';
    }
    const result = await runExecuteSandbox(code, cwd);
    return formatResult(result);
  },
};

export const ALL_TOOLS: ToolDefinition[] = [capSearch, capExecute];
