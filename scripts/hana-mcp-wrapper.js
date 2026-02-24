#!/usr/bin/env node
/**
 * Wrapper that sets VCAP_SERVICES_FILE_PATH before starting hana-cli MCP server.
 *
 * Why this is needed:
 * 1. hana-cli MCP executor.js sets cwd to its own install dir (not your project)
 * 2. hana-cli connections.js deletes process.env.VCAP_SERVICES before resolving
 * 3. VCAP_SERVICES_FILE_PATH survives the delete and @sap/xsenv reads it
 *
 * Usage in .mcp.json:
 *   "hana-cli": {
 *     "command": "node",
 *     "args": ["./scripts/hana-mcp-wrapper.js"],
 *   }
 *
 * Or simply add env to the existing hana-cli config:
 *   "env": { "VCAP_SERVICES_FILE_PATH": "/path/to/.vcap-services.json" }
 */
const { readFileSync, writeFileSync, existsSync } = require('fs');
const { resolve } = require('path');
const { spawn } = require('child_process');

const projectRoot = resolve(__dirname, '..');
const vcapFile = resolve(projectRoot, '.vcap-services.json');

// Generate .vcap-services.json from default-env.json if needed
if (!existsSync(vcapFile)) {
  try {
    const envFile = resolve(projectRoot, 'default-env.json');
    const envData = JSON.parse(readFileSync(envFile, 'utf8'));
    if (envData.VCAP_SERVICES) {
      writeFileSync(vcapFile, JSON.stringify(envData.VCAP_SERVICES));
      process.stderr.write(`[hana-mcp-wrapper] Generated ${vcapFile}\n`);
    }
  } catch (e) {
    process.stderr.write(`[hana-mcp-wrapper] Warning: ${e.message}\n`);
  }
}

// Set the file path so @sap/xsenv finds it (survives hana-cli's env.VCAP_SERVICES delete)
process.env.VCAP_SERVICES_FILE_PATH = vcapFile;

// Find hana-cli MCP server
const nodeVersion = process.version;
const hanaMcpPath = process.argv[2] ||
  resolve(process.env.HOME, '.nvm/versions/node', nodeVersion, 'lib/node_modules/hana-cli/mcp-server/build/index.js');

const child = spawn('node', [hanaMcpPath], {
  cwd: projectRoot,
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => process.exit(code || 0));
process.on('SIGINT', () => child.kill('SIGINT'));
process.on('SIGTERM', () => child.kill('SIGTERM'));
