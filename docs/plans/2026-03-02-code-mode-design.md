# Code Mode MCP Conversion — Design Document

**Date:** 2026-03-02
**Status:** Approved
**Branch:** mcpV2

## Problem Statement

The current sflight-mcp server exposes 19 individual tools, each with its own description and schema. Every conversation loads all 19 tool definitions (~5,000-6,000 tokens) regardless of what the user needs. The `cap_cql_query` tool alone consumes ~3,000 tokens because it embeds all table names, 10 JOIN patterns, key columns, derived metrics, and date functions directly in its description.

This is the classic "tool bloat" problem described by both Anthropic and Cloudflare:
- Token waste on unused tool definitions
- Intermediate query results flow through model context
- No composition — each tool call is a separate round trip
- Schema knowledge is static, not discoverable

## Decision

**Full replacement** of all 19 tools with **2 Code Mode tools**: `cap_search` + `cap_execute`.

Resources and prompts are removed. Schema discovery happens through `cap_search`. Workflow guidance moves into SKILL.md and CLAUDE.md.

## Sources

- [Anthropic: Code Execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)
- [Cloudflare: Code Mode — give agents an entire API in 1,000 tokens](https://blog.cloudflare.com/code-mode-mcp/)
- [GitHub MCP Discussion #629: Production Results](https://github.com/orgs/modelcontextprotocol/discussions/629) — 98% token reduction validated

## Architecture

### Before (19 tools, 3 resources, 6 prompts)

```
Agent ──tool/list──► MCP Server returns 19 tool schemas (~5,000 tokens)
Agent ──cap_entities──► Server ──► Result
Agent ──cap_nav_map──► Server ──► Result (might not even need this)
Agent ──cap_cql_query──► Server ──► 500 rows through model context
Agent ──cap_cql_query──► Server ──► Another 500 rows through context
```

**Token cost per conversation:** ~5,000 (definitions) + N * result_size

### After (2 tools, 0 resources, 0 prompts)

```
Agent ──tool/list──► MCP Server returns 2 tool schemas (~1,000 tokens)
Agent ──cap_search──► Writes JS: "find entities with Carrier associations"
                      Server runs in sandbox, returns only matching entities
Agent ──cap_execute──► Writes JS: query + filter + format
                       Server runs in sandbox, returns 5 filtered rows
```

**Token cost per conversation:** ~1,000 (definitions) + N * filtered_result_size

### Token Reduction Estimate

| Component | Before | After | Reduction |
|-----------|--------|-------|-----------|
| Tool definitions | ~5,000 | ~1,000 | 80% |
| Typical query result | ~2,000 | ~500 | 75% (filtered in sandbox) |
| Schema discovery | ~1,500 | ~300 | 80% (on-demand) |
| **Per-conversation total** | **~8,500** | **~1,800** | **~79%** |

## Tool Definitions

### Tool 1: `cap_search`

**Purpose:** Explore the CDS data model by writing JavaScript against the compiled CSN (Core Schema Notation).

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "code": {
      "type": "string",
      "description": "JavaScript async function body. Globals: model (compiled CSN with all entity definitions, services, associations), tables (SQL table name array), log(data) to return results."
    }
  },
  "required": ["code"]
}
```

**Sandbox Globals:**
- `model` — Parsed CSN object (the entire CDS data model)
- `tables` — Array of SQL table names (e.g., `['flights_Carriers', 'flights_Flights', ...]`)
- `log(data)` — Output function; only logged data reaches the model
- Safe built-ins: `JSON`, `Math`, `Array`, `Object`, `String`, `Number`, `Date`, `RegExp`, `Map`, `Set`

**Example Interactions:**

```javascript
// "What entities exist in this model?"
const entities = Object.entries(model.definitions)
  .filter(([_, d]) => d.kind === 'entity')
  .map(([name, d]) => ({
    name,
    isView: !!d.query,
    fields: Object.keys(d.elements || {}).length,
    keys: Object.entries(d.elements || {})
      .filter(([_, e]) => e.key).map(([n]) => n)
  }));
log(entities);
```

```javascript
// "How do Flights relate to Carriers?"
const flights = model.definitions['flights.Flights'];
const assocs = Object.entries(flights.elements || {})
  .filter(([_, e]) => e.type === 'cds.Association' || e.type === 'cds.Composition')
  .map(([name, e]) => ({
    name, target: e.target,
    cardinality: e.cardinality?.max === '*' ? 'to-many' : 'to-one',
    on: e.on  // raw ON condition tokens
  }));
log(assocs);
```

```javascript
// "What tables can I query? Give me the SQL table names."
log(tables);
```

### Tool 2: `cap_execute`

**Purpose:** Run SQL queries against the in-memory SQLite database and process results with JavaScript. Data stays in the execution environment — only explicitly logged output reaches the model.

**Input Schema:**
```json
{
  "type": "object",
  "properties": {
    "code": {
      "type": "string",
      "description": "JavaScript async function body. Globals: query(sql, maxRows?) executes SQL against the SFLIGHT SQLite database and returns rows, log(data) to return results."
    }
  },
  "required": ["code"]
}
```

**Sandbox Globals:**
- `query(sql, maxRows?)` — Executes SQL against in-memory SQLite, returns array of row objects. Default maxRows: 100, max: 500.
- `log(data)` — Output function; only logged data reaches the model
- Safe built-ins: same as `cap_search`

**Example Interactions:**

```javascript
// "Top 5 airlines by seat occupancy"
const results = await query(`
  SELECT c.CARRNAME, c.CARRID,
    ROUND(AVG(CAST(f.SEATSOCC AS FLOAT) / f.SEATSMAX * 100), 1) as occupancy_pct
  FROM flights_Flights f
  JOIN flights_Carriers c ON c.MANDT = f.MANDT AND c.CARRID = f.CARRID
  WHERE f.SEATSMAX > 0
  GROUP BY c.CARRID, c.CARRNAME
  ORDER BY occupancy_pct DESC
  LIMIT 5
`);
log(results);
```

```javascript
// "Year-over-year booking growth with revenue"
const years = await query(`
  SELECT substr(FLDATE, 1, 4) as year,
    COUNT(*) as bookings,
    ROUND(SUM(FORCURAM), 2) as revenue
  FROM flights_Bookings
  GROUP BY year ORDER BY year
`);

// Calculate YoY growth in JS — no extra query needed
const enriched = years.map((row, i) => ({
  ...row,
  growth: i > 0
    ? ((row.bookings - years[i-1].bookings) / years[i-1].bookings * 100).toFixed(1) + '%'
    : '—'
}));
log(enriched);
```

```javascript
// Composition: multiple queries + JS transform in one execution
const carriers = await query("SELECT CARRID, CARRNAME FROM flights_Carriers");
const flights = await query(`
  SELECT CARRID, COUNT(*) as cnt
  FROM flights_Flights GROUP BY CARRID
`);

const merged = carriers.map(c => ({
  ...c,
  flights: flights.find(f => f.CARRID === c.CARRID)?.cnt || 0
})).sort((a, b) => b.flights - a.flights);

log(merged.slice(0, 10)); // Top 10 only — model sees 10 rows, not thousands
```

## Sandbox Architecture

### Subprocess Isolation

Agent-generated code runs in a **child process** with restricted globals. No access to filesystem, environment variables, require/import, or network.

```
MCP Server (parent)
  │
  ├── cap_search request
  │   ├── Compile CDS model (cached 60s)
  │   ├── Spawn: node search-sandbox.cjs
  │   │   └── Restricted VM context: { model, tables, log }
  │   │       └── Agent code executes here
  │   └── Collect log() output → return to model
  │
  └── cap_execute request
      ├── Spawn: node execute-sandbox.cjs
      │   ├── Boot CDS + SQLite (loads CSV seed data)
      │   ├── Restricted VM context: { query, log }
      │   │   └── Agent code executes here
      │   └── Collect log() output → return to model
      └── Return filtered results
```

### Security Controls

| Control | Implementation |
|---------|----------------|
| No `require`/`import` | Not exposed in sandbox context |
| No `process`/`fs` | Not exposed in sandbox context |
| No `fetch`/network | Not exposed in sandbox context |
| No `eval`/`Function` | Blocked in sandbox |
| Execution timeout | 15 seconds max |
| Output limit | 50KB max from log() |
| Read-only model | CSN object is frozen |

### Sandbox Scripts

Two new scripts alongside the existing `query-runner.cjs`:

**`search-sandbox.cjs`**
- Receives: base64-encoded agent code + CSN JSON + table list
- Creates restricted VM context with `model`, `tables`, `log`
- Runs agent code via `vm.runInNewContext()`
- Returns collected log output as JSON

**`execute-sandbox.cjs`**
- Receives: base64-encoded agent code + project root
- Boots CDS + SQLite in-memory (same as existing query-runner.cjs)
- Creates restricted VM context with `query()`, `log()`
- Runs agent code via `vm.runInNewContext()`
- Returns collected log output as JSON

## File Structure

### Files Changed

```
mcp-server/src/
  index.ts              ← Simplified: only tools capability, 2 tools
  code-mode-tools.ts    ← NEW: cap_search + cap_execute definitions
  sandbox-runner.ts     ← NEW: Subprocess sandbox orchestration
  cap-tools.ts          ← DELETED (replaced by code-mode-tools.ts)
  cap-resources.ts      ← DELETED (discovery via cap_search)
  cap-prompts.ts        ← DELETED (workflows via SKILL.md)
  cds-executor.ts       ← KEPT (CDS compile + shell execution)
  output-formatter.ts   ← DELETED (formatting absorbed into code-mode-tools.ts formatResult())

mcp-server/scripts/
  query-runner.cjs      ← KEPT (SQLite engine, reused by execute-sandbox)
  search-sandbox.cjs    ← NEW: Isolated search VM
  execute-sandbox.cjs   ← NEW: Isolated execute VM
```

### Files NOT Changed

- `db/schema.cds` — Data model unchanged
- `db/data/*.csv` — Seed data unchanged
- `srv/flights-service.cds` — OData service unchanged
- `srv/flights-service.js` — Custom handler unchanged
- `package.json` — No new dependencies (Node vm is built-in)
- `mta.yaml` — BTP deployment unchanged

## Migration Path

### What Moves Where

| Old Component | New Location |
|---------------|--------------|
| 19 tool definitions | 2 Code Mode tools |
| `cap_cql_query` JOIN patterns | Discoverable via `cap_search` against CSN |
| `cap_cql_query` table names | `tables` array in search sandbox |
| `cap://schema` resource | `cap_search`: `Object.entries(model.definitions)...` |
| `cap://services` resource | `cap_search`: `filter(d => d.kind === 'service')` |
| `cap://data-stats` resource | `cap_execute`: `query("SELECT name FROM sqlite_master...")` |
| 6 prompt workflows | Example patterns in SKILL.md |
| `cap_data_distribution` | `cap_execute`: GROUP BY + JS percentage calc |
| `cap_yoy_growth` | `cap_execute`: GROUP BY year + JS growth calc |
| `cap_build` | `cap_execute` can shell out OR separate traditional tool |

### CLAUDE.md Updates

The project CLAUDE.md will be updated to:
- Document the 2 Code Mode tools instead of 19 tools
- Include example `cap_search` and `cap_execute` usage patterns
- Reference the SKILL.md for comprehensive workflow recipes

## Testing Strategy

### Verification Checklist

| # | Check | Method |
|---|-------|--------|
| 1 | MCP server starts | Spawn and check tool/list response |
| 2 | Returns exactly 2 tools | Parse tool/list JSON |
| 3 | cap_search can explore model | Send search code, verify entity list |
| 4 | cap_execute can query data | Send SQL code, verify results |
| 5 | Sandbox blocks require | Send `require('fs')`, expect error |
| 6 | Sandbox blocks process | Send `process.exit()`, expect error |
| 7 | Timeout enforced | Send infinite loop, expect timeout error |
| 8 | Output limit enforced | Send huge log(), expect truncation |
| 9 | Composition works | Send multi-query code, verify merged results |
| 10 | Claude Code integration | Launch claude, ask "How many airlines?", verify answer |

### Test Scripts

Update `test/mcp-test.sh` to test the 2 new tools instead of old 19.

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Agent writes bad JS | Sandbox catches errors, returns clear error messages |
| Agent tries to escape sandbox | Node vm + subprocess isolation + no dangerous globals |
| Performance regression | CSN cache (60s TTL) + SQLite in-memory = fast |
| Breaking existing demos | Full replacement is intentional; old tools are in git history |
| Complex queries harder to write | SKILL.md provides recipes; Claude excels at writing code |
| MCP clients without code support | This is a demo project; Claude Code is the primary client |

## Appendix: Token Budget

### Tool Definition Tokens (estimated)

**cap_search:**
```
name: 10 tokens
description: ~150 tokens (explains model object, tables array, log function)
inputSchema: ~50 tokens
Total: ~210 tokens
```

**cap_execute:**
```
name: 10 tokens
description: ~150 tokens (explains query function, log function)
inputSchema: ~50 tokens
Total: ~210 tokens
```

**Server overhead:** ~80 tokens

**Grand total: ~500 tokens** (down from ~5,000-6,000)

This is a **90% reduction** in tool definition tokens, better than the initial 80% estimate because we're removing ALL 19 tools, not just the heavy ones.
