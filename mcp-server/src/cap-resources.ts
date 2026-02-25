/**
 * CAP CDS Resource Definitions
 *
 * MCP Resources expose static/dynamic data that clients can read upfront
 * as context — without the AI needing to call a tool first.
 *
 * Resources vs Tools:
 *   - Tools: AI decides to call them, passes arguments, gets results
 *   - Resources: Client reads them proactively, provides context to the AI
 *
 * We expose:
 *   Static resources:
 *     cap://schema       — Full CDS data model (compiled CSN summary)
 *     cap://services     — Service definitions and exposed entities
 *     cap://data-stats   — Row counts for all entities
 *
 *   Resource templates (parameterized):
 *     cap://entity/{name} — Detail for a specific entity
 */

import { getCompiledModel, executeShell } from './cds-executor.js';
import {
  formatMarkdownTable,
  formatEntityDetail,
  formatServiceList,
} from './output-formatter.js';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function queryRunnerPath(): string {
  return path.resolve(__dirname, '..', 'scripts', 'query-runner.cjs');
}

// ─── Types ───────────────────────────────────────────────────

export interface ResourceDefinition {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
  handler: (cwd: string) => Promise<string>;
}

export interface ResourceTemplateDefinition {
  uriTemplate: string;
  name: string;
  description: string;
  mimeType: string;
  handler: (params: Record<string, string>, cwd: string) => Promise<string>;
}

// ─── Static Resources ────────────────────────────────────────

const schemaResource: ResourceDefinition = {
  uri: 'cap://schema',
  name: 'CDS Data Model',
  description:
    'Complete CDS data model: all 26 entities and 4 views with key fields, ' +
    'element counts, associations, and compositions. Read this first to ' +
    'understand the SFLIGHT data model before querying.',
  mimeType: 'text/markdown',
  handler: async (cwd) => {
    const csn = await getCompiledModel(cwd);
    const model = JSON.parse(csn);
    const defs = model.definitions || {};

    const entities: Array<{
      name: string;
      kind: string;
      keys: string[];
      elements: number;
      associations: number;
      compositions: number;
    }> = [];

    for (const [name, def] of Object.entries(defs) as Array<[string, any]>) {
      if (def.kind !== 'entity') continue;

      // Skip service projections
      const parts = name.split('.');
      if (parts.length > 1) {
        const parentName = parts.slice(0, -1).join('.');
        if (defs[parentName]?.kind === 'service') continue;
      }

      const isView = !!def.query;
      const elements = def.elements || {};
      const keys: string[] = [];
      let assocCount = 0;
      let compCount = 0;

      for (const [, elem] of Object.entries(elements) as Array<[string, any]>) {
        if (elem.key) keys.push(elem.key === true ? '' : '');
        if (elem.type === 'cds.Association') assocCount++;
        if (elem.type === 'cds.Composition') compCount++;
      }

      // Collect actual key names
      const keyNames: string[] = [];
      for (const [elemName, elem] of Object.entries(elements) as Array<[string, any]>) {
        if (elem.key) keyNames.push(elemName);
      }

      entities.push({
        name,
        kind: isView ? 'view' : 'entity',
        keys: keyNames,
        elements: Object.keys(elements).length,
        associations: assocCount,
        compositions: compCount,
      });
    }

    if (entities.length === 0) return 'No entities found.';

    const headers = ['Entity', 'Kind', 'Keys', '#Elements', '#Assoc', '#Comp'];
    const rows = entities.map((e) => [
      e.name,
      e.kind,
      e.keys.join(', '),
      String(e.elements),
      String(e.associations),
      String(e.compositions),
    ]);

    let md = `# CDS Data Model — SFLIGHT\n\n`;
    md += `**Entities:** ${entities.filter((e) => e.kind === 'entity').length} | `;
    md += `**Views:** ${entities.filter((e) => e.kind === 'view').length}\n\n`;
    md += `Key relationships: Carriers → Connections → Flights → Bookings → Tickets/Invoices\n\n`;
    md += formatMarkdownTable(headers, rows);

    return md;
  },
};

const servicesResource: ResourceDefinition = {
  uri: 'cap://services',
  name: 'CDS Service Definitions',
  description:
    'All CDS services with their OData paths, exposed entities, functions, and actions. ' +
    'Shows the API surface available for querying.',
  mimeType: 'text/markdown',
  handler: async (cwd) => {
    const csn = await getCompiledModel(cwd);
    const model = JSON.parse(csn);
    return formatServiceList(model);
  },
};

const dataStatsResource: ResourceDefinition = {
  uri: 'cap://data-stats',
  name: 'Data Statistics',
  description:
    'Row counts for all entities in the database. Shows which tables have data ' +
    'and how many rows each contains — useful context before writing queries.',
  mimeType: 'text/markdown',
  handler: async (cwd) => {
    const output = await executeShell(
      `node "${queryRunnerPath()}" --stats`,
      cwd,
      15000
    );

    try {
      const result = JSON.parse(output.trim());
      if (result.error) return `Error: ${result.error}`;

      const { entities, totalEntities } = result;
      const headers = ['Entity', 'SQL Table Name', 'Rows'];
      const rows = entities.map((e: any) => [e.entity, e.table, String(e.rows)]);

      return `# Data Statistics\n\n**Total entities with data:** ${totalEntities}\n\n` +
        formatMarkdownTable(headers, rows);
    } catch {
      return `Raw output:\n${output.slice(0, 5000)}`;
    }
  },
};

// ─── Resource Templates ──────────────────────────────────────

const entityTemplate: ResourceTemplateDefinition = {
  uriTemplate: 'cap://entity/{name}',
  name: 'Entity Detail',
  description:
    'Full definition of a specific CDS entity: all fields with types, ' +
    'associations, compositions, and ON conditions. ' +
    'Use entity short name (e.g., "Carriers") or full name (e.g., "flights.Carriers").',
  mimeType: 'text/markdown',
  handler: async (params, cwd) => {
    const entityName = params.name;
    if (!entityName) return 'Error: entity name is required.';

    const csn = await getCompiledModel(cwd);
    const model = JSON.parse(csn);
    const defs = model.definitions || {};

    // Find entity by exact name or suffix match
    let entityDef: any = null;
    let fullName = '';
    for (const [name, def] of Object.entries(defs) as Array<[string, any]>) {
      if (def.kind !== 'entity') continue;
      if (name === entityName || name.endsWith(`.${entityName}`)) {
        entityDef = def;
        fullName = name;
        break;
      }
    }

    if (!entityDef) return `Entity "${entityName}" not found.`;

    return formatEntityDetail(fullName, entityDef);
  },
};

// ─── Exports ─────────────────────────────────────────────────

export const ALL_RESOURCES: ResourceDefinition[] = [
  schemaResource,
  servicesResource,
  dataStatsResource,
];

export const ALL_RESOURCE_TEMPLATES: ResourceTemplateDefinition[] = [
  entityTemplate,
];

/**
 * Match a URI against a simple template like "cap://entity/{name}"
 * and return extracted parameters, or null if no match.
 */
export function matchTemplate(
  uri: string,
  template: string
): Record<string, string> | null {
  // Convert template to regex: "cap://entity/{name}" → /^cap:\/\/entity\/(.+)$/
  const paramNames: string[] = [];
  const regexStr = template.replace(/\{(\w+)\}/g, (_match, paramName) => {
    paramNames.push(paramName);
    return '([^/]+)';
  });
  const regex = new RegExp(`^${regexStr.replace(/\//g, '\\/')}$`);
  const match = uri.match(regex);

  if (!match) return null;

  const params: Record<string, string> = {};
  paramNames.forEach((name, i) => {
    params[name] = decodeURIComponent(match[i + 1]);
  });
  return params;
}
