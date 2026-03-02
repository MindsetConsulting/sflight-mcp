#!/usr/bin/env node
/**
 * Execute Sandbox — Isolated VM for cap_execute Code Mode tool.
 *
 * Boots CDS + SQLite in-memory from cwd, loads CSV seed data.
 * Receives user code via CLI arg 1 (base64-encoded).
 * Optional timeout via CLI arg 2 (ms, default: 10000, max: 15s).
 *
 * Sandbox globals: query(sql, maxRows?), log()
 * Safe built-ins: JSON, Math, Array, Object, String, Number, Date, RegExp, Map, Set
 * Blocked: require, import, fs, process, fetch, eval, Function
 *
 * Output: JSON { logs: string[], result?: any, queries?: [{sql, rowCount}] }
 * On error: { error: string, logs: string[] }
 */

const vm = require('vm');

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

(async () => {
  // Declared outside try so catch block can access accumulated logs
  const logs = [];
  const queryLog = [];

  try {
    const userCode = Buffer.from(process.argv[2], 'base64').toString('utf-8');
    // Timeout: default 10s, capped at 15s max
    const maxMs = Math.min(parseInt(process.argv[3] || '10000', 10), 15000);

    const { db } = await boot();

    // 50KB output limit tracking
    let logBytes = 0;
    const MAX_LOG_BYTES = 51200; // 50KB

    const queryFn = async (sql, maxRows = 100) => {
      // Enforce maxRows bounds: min 1, max 500
      maxRows = Math.min(Math.max(1, maxRows), 500);

      const upper = sql.toUpperCase().trim();

      // Block destructive DDL/DML — this is a read-only query sandbox
      const dangerous = /^\s*(DROP|ALTER|CREATE|TRUNCATE|DELETE|INSERT|UPDATE|REPLACE)\s/i;
      if (dangerous.test(sql)) {
        throw new Error('Write operations (INSERT, UPDATE, DELETE, DROP, ALTER, CREATE, TRUNCATE) are not allowed. This is a read-only query sandbox.');
      }

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
      const entry = args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a, null, 2))).join(' ');
      logBytes += Buffer.byteLength(entry, 'utf-8');
      if (logBytes > MAX_LOG_BYTES) {
        if (!logs.length || logs[logs.length - 1] !== '[output truncated at 50KB]') {
          logs.push('[output truncated at 50KB]');
        }
        return;
      }
      logs.push(entry);
    };

    // Restricted sandbox context — no require, fs, process, fetch, eval, Function
    // Use Object.create(null) to eliminate prototype chain (prevents VM escape
    // via this.constructor.constructor("return process")() ).
    const context = vm.createContext(Object.create(null));
    Object.defineProperties(context, {
      // Core sandbox functions — read-only, non-configurable
      query:    { value: queryFn, writable: false, configurable: false },
      log:      { value: logFn,   writable: false, configurable: false },

      // Block eval and Function constructor — throwing stubs
      eval:     { value: () => { throw new Error('eval is not allowed in the sandbox'); },                writable: false, configurable: false },
      Function: { value: () => { throw new Error('Function constructor is not allowed in the sandbox'); }, writable: false, configurable: false },

      // Safe built-ins — provide standard JS library objects
      JSON:     { value: JSON,     writable: false, configurable: false },
      Math:     { value: Math,     writable: false, configurable: false },
      Array:    { value: Array,    writable: false, configurable: false },
      Object:   { value: Object,   writable: false, configurable: false },
      String:   { value: String,   writable: false, configurable: false },
      Number:   { value: Number,   writable: false, configurable: false },
      Date:     { value: Date,     writable: false, configurable: false },
      RegExp:   { value: RegExp,   writable: false, configurable: false },
      Map:      { value: Map,      writable: false, configurable: false },
      Set:      { value: Set,      writable: false, configurable: false },
      Promise:  { value: Promise,  writable: false, configurable: false },
      Error:    { value: Error,    writable: false, configurable: false },

      // Constants
      undefined: { value: undefined, writable: false, configurable: false },
      NaN:       { value: NaN,       writable: false, configurable: false },
      Infinity:  { value: Infinity,  writable: false, configurable: false },

      // Console-like helpers (map to our log)
      console:   { value: Object.freeze({ log: logFn, warn: logFn, error: logFn, info: logFn }), writable: false, configurable: false },
    });

    // Wrap in async IIFE so user code can use `await`.
    // Prefix with strict mode so assignments to frozen properties throw TypeError.
    const wrappedCode = `"use strict";\n(async () => { ${userCode} })()`;
    const result = await vm.runInContext(wrappedCode, context, {
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
  } catch (e) {
    // logs and queryLog are declared outside try, so they include everything accumulated before the error
    process.stdout.write(JSON.stringify({ error: e.message, logs, queries: queryLog }) + '\n');
    process.exit(1);
  }
})();
