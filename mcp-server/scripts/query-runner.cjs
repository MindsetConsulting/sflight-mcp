#!/usr/bin/env node
/**
 * CDS Query Runner — Standalone script for executing SQL against CAP project data.
 *
 * Boots CDS from the current working directory, deploys the model to an in-memory
 * SQLite database, loads all CSV seed data, and executes the provided SQL query.
 *
 * Usage:
 *   node query-runner.cjs <base64-encoded-sql> [maxRows]
 *   node query-runner.cjs --stats                        (entity row counts)
 *   node query-runner.cjs --sample <entity> [maxRows]    (sample data from entity)
 *   node query-runner.cjs --schema                       (list all tables/columns)
 *
 * Output: JSON to stdout. CDS bootstrap logs suppressed.
 *
 * Requirements: Must be run from a CAP project root with @sap/cds and @cap-js/sqlite.
 */

const path = require('path');

// Resolve @sap/cds from the target project's node_modules (cwd), not this script's location
const cdsPath = require.resolve('@sap/cds', { paths: [process.cwd()] });
const cds = require(cdsPath);

// Suppress ALL console.log output during CDS bootstrap.
// CDS deploy writes "  > init from ..." lines to console.log which pollutes stdout.
// Our final result uses process.stdout.write() directly, bypassing this override.
const _origLog = console.log;
let _suppressLogs = true;
console.log = (...args) => {
  if (_suppressLogs) return;
  _origLog.apply(console, args);
};

/**
 * Boot CDS runtime: load model, connect to SQLite in-memory, deploy + seed.
 * Returns { db, model } — model is the CSN object.
 */
async function boot() {
  const model = await cds.load('*');
  const db = await cds.connect.to('db');
  await cds.deploy(model).to(db);
  return { db, model };
}

async function runQuery(db, sql, maxRows) {
  const upper = sql.toUpperCase().trim();
  const isSelect = upper.startsWith('SELECT') || upper.startsWith('WITH');
  let finalSql = sql;
  if (isSelect && !upper.includes('LIMIT')) {
    finalSql = `${sql} LIMIT ${maxRows}`;
  }

  const result = await db.run(finalSql);
  const rows = Array.isArray(result) ? result : [result];
  return {
    query: sql,
    rows,
    count: rows.length,
    truncated: rows.length >= maxRows,
  };
}

async function getStats(db, model) {
  const defs = model.definitions || {};
  const entities = [];

  for (const [name, def] of Object.entries(defs)) {
    if (def.kind !== 'entity') continue;
    // Skip service-level projections (FQN contains a service prefix)
    const parts = name.split('.');
    if (parts.length > 1) {
      const parentName = parts.slice(0, -1).join('.');
      const parent = defs[parentName];
      if (parent && parent.kind === 'service') continue;
    }

    const tableName = name.replace(/\./g, '_');
    try {
      const countResult = await db.run(`SELECT COUNT(*) as cnt FROM ${tableName}`);
      const cnt = countResult[0]?.cnt ?? 0;
      entities.push({ entity: name, table: tableName, rows: cnt });
    } catch {
      // Table might not exist (abstract entities, compositions, etc.)
    }
  }

  entities.sort((a, b) => b.rows - a.rows);
  return { entities, totalEntities: entities.length };
}

async function getSample(db, entityName, maxRows) {
  const candidates = [
    entityName,
    entityName.replace(/\./g, '_'),
    `flights_${entityName}`,
  ];

  for (const table of candidates) {
    try {
      const rows = await db.run(`SELECT * FROM ${table} LIMIT ${maxRows}`);
      if (rows && rows.length > 0) {
        return {
          entity: entityName,
          table,
          columns: Object.keys(rows[0]),
          rows,
          count: rows.length,
        };
      }
    } catch {
      continue;
    }
  }

  return { error: `Entity "${entityName}" not found. Use --stats to see available entities.` };
}

async function getSchema(model) {
  const defs = model.definitions || {};
  const tables = [];

  for (const [name, def] of Object.entries(defs)) {
    if (def.kind !== 'entity') continue;
    if (!def.elements) continue;

    // Skip service projections
    const parts = name.split('.');
    if (parts.length > 1) {
      const parentName = parts.slice(0, -1).join('.');
      const parent = defs[parentName];
      if (parent && parent.kind === 'service') continue;
    }

    const columns = [];
    for (const [elemName, elem] of Object.entries(def.elements)) {
      if (elem.type === 'cds.Association' || elem.type === 'cds.Composition') continue;
      columns.push({
        name: elemName,
        type: (elem.type || '').replace('cds.', ''),
        key: !!elem.key,
        length: elem.length || null,
      });
    }

    tables.push({
      entity: name,
      table: name.replace(/\./g, '_'),
      columns,
      isView: !!def.query,
    });
  }

  return { tables, totalTables: tables.length };
}

// ─── Main ────────────────────────────────────────────────────

(async () => {
  const args = process.argv.slice(2);

  if (args.length === 0) {
    process.stderr.write(
      'Usage:\n' +
      '  node query-runner.cjs <base64-sql> [maxRows]\n' +
      '  node query-runner.cjs --stats\n' +
      '  node query-runner.cjs --sample <entity> [maxRows]\n' +
      '  node query-runner.cjs --schema\n'
    );
    process.exit(1);
  }

  const { db, model } = await boot();
  let result;

  if (args[0] === '--stats') {
    result = await getStats(db, model);
  } else if (args[0] === '--sample') {
    const entity = args[1];
    const maxRows = parseInt(args[2] || '10', 10);
    if (!entity) {
      process.stderr.write('--sample requires an entity name\n');
      process.exit(1);
    }
    result = await getSample(db, entity, maxRows);
  } else if (args[0] === '--schema') {
    result = await getSchema(model);
  } else {
    // SQL query: first arg is base64-encoded SQL
    const sql = Buffer.from(args[0], 'base64').toString('utf-8');
    const maxRows = parseInt(args[1] || '50', 10);
    result = await runQuery(db, sql, maxRows);
  }

  // Output JSON result
  process.stdout.write(JSON.stringify(result) + '\n');
  process.exit(0);
})().catch(e => {
  const errObj = { error: e.message };
  process.stdout.write(JSON.stringify(errObj) + '\n');
  process.exit(1);
});
