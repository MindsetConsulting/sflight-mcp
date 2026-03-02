#!/usr/bin/env node
/**
 * Patches @gavdi/cap-mcp resources.js to add a list callback
 * so resources appear in resources/list (not just resources/templates/list).
 *
 * Run after npm install: node scripts/patch-mcp-resources.js
 */
const fs = require('fs');
const path = require('path');

const target = path.join(__dirname, '..', 'node_modules', '@gavdi', 'cap-mcp', 'lib', 'mcp', 'resources.js');

if (!fs.existsSync(target)) {
  console.log('[patch] @gavdi/cap-mcp not found, skipping');
  process.exit(0);
}

let code = fs.readFileSync(target, 'utf8');

const needle = 'list: undefined,';
if (!code.includes(needle)) {
  console.log('[patch] Already patched or needle not found, skipping');
  process.exit(0);
}

const replacement = `list: async () => ({ resources: [{
            uri: baseUri,
            name: model.name,
            description: model.description,
        }] }),`;

// Also need to add the baseUri variable before the template construction
const templateNeedle = '    const template = new custom_resource_template_1.CustomResourceTemplate(resourceTemplateUri, {';
const templateReplacement = `    const baseUri = \`odata://\${model.serviceName}/\${model.name}\`;
    const template = new custom_resource_template_1.CustomResourceTemplate(resourceTemplateUri, {`;

code = code.replace(templateNeedle, templateReplacement);
code = code.replace(needle, replacement);

fs.writeFileSync(target, code, 'utf8');
console.log('[patch] Patched @gavdi/cap-mcp resources.js — list callback added');
