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

/** Recursively freeze an object so sandbox code cannot mutate it. */
function deepFreeze(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  Object.freeze(obj);
  for (const val of Object.values(obj)) {
    if (typeof val === 'object' && val !== null && !Object.isFrozen(val)) {
      deepFreeze(val);
    }
  }
  return obj;
}

let stdinData = '';
process.stdin.setEncoding('utf-8');
process.stdin.on('data', (chunk) => { stdinData += chunk; });
process.stdin.on('end', () => {
  // Declared outside try so catch block can access accumulated logs
  const logs = [];
  try {
    const model = JSON.parse(stdinData);
    const userCode = Buffer.from(process.argv[2], 'base64').toString('utf-8');
    const maxMs = Math.min(parseInt(process.argv[3] || '5000', 10), 15000);

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
    Object.freeze(tables);

    // Collected log output — capped at 50KB total
    let logBytes = 0;
    const MAX_LOG_BYTES = 51200; // 50KB
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

    // Deep-freeze the model so sandbox code cannot mutate it
    deepFreeze(model);

    // Restricted sandbox context — no require, fs, process, fetch, eval
    // Use Object.create(null) to eliminate prototype chain (prevents VM escape
    // via this.constructor.constructor("return process")() ).
    const context = vm.createContext(Object.create(null));
    Object.defineProperties(context, {
      model:    { value: model,  writable: false, configurable: false },
      tables:   { value: tables, writable: false, configurable: false },
      log:      { value: logFn,  writable: false, configurable: false },
      eval:     { value: () => { throw new Error('eval is not allowed in the sandbox'); },     writable: false, configurable: false },
      Function: { value: () => { throw new Error('Function constructor is not allowed in the sandbox'); }, writable: false, configurable: false },
    });

    // Run in strict mode so assignments to frozen properties throw TypeError
    const result = vm.runInContext(`"use strict";\n${userCode}`, context, {
      timeout: maxMs,
      filename: 'cap_search.js',
    });

    process.stdout.write(
      JSON.stringify({ logs, result: result !== undefined ? result : null }) + '\n'
    );
    process.exit(0);
  } catch (e) {
    process.stdout.write(JSON.stringify({ error: e.message, logs }) + '\n');
    process.exit(1);
  }
});
