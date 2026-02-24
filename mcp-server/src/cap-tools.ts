/**
 * CAP CDS Tool Definitions
 *
 * Each tool has:
 *  - name: MCP tool name (prefixed with cap_)
 *  - description: what the tool does
 *  - inputSchema: JSON Schema for parameters
 *  - handler: async function that executes the tool
 *
 * Execution strategy: Hybrid
 *  - In-process: cds compile (fast model introspection, <100ms)
 *  - Shell out:  cds build, cds deploy, cf commands (long-running ops)
 */

import { fileURLToPath } from 'url';
import path from 'path';
import { executeShell, executeCds, getCompiledModel, clearCsnCache } from './cds-executor.js';
import { formatMarkdownTable, formatEntityDetail, formatServiceList, formatNavMap } from './output-formatter.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required?: string[];
  };
  handler: (args: Record<string, any>, cwd: string) => Promise<string>;
}

// ─── Model Introspection Tools ───────────────────────────────

const capEntities: ToolDefinition = {
  name: 'cap_entities',
  description:
    'List all CDS entities in the CAP project with their key fields, element count, and association/composition counts. ' +
    'Useful for understanding the data model at a glance.',
  inputSchema: {
    type: 'object',
    properties: {
      namespace: {
        type: 'string',
        description: 'Filter entities by namespace prefix (e.g., "flights")',
      },
      includeViews: {
        type: 'boolean',
        description: 'Include CDS view entities (default: true)',
        default: true,
      },
    },
  },
  handler: async (args, cwd) => {
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
      if (args.namespace && !name.startsWith(args.namespace)) continue;

      const isView = !!def.query;
      if (!args.includeViews && args.includeViews !== undefined && isView) continue;

      const elements = def.elements || {};
      const keys: string[] = [];
      let assocCount = 0;
      let compCount = 0;

      for (const [elemName, elem] of Object.entries(elements) as Array<[string, any]>) {
        if (elem.key) keys.push(elemName);
        if (elem.type === 'cds.Association') assocCount++;
        if (elem.type === 'cds.Composition') compCount++;
      }

      entities.push({
        name,
        kind: isView ? 'view' : 'entity',
        keys,
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

    return `## CDS Entities\n\n**Total:** ${entities.length}\n\n` + formatMarkdownTable(headers, rows);
  },
};

const capEntityDetail: ToolDefinition = {
  name: 'cap_entity_detail',
  description:
    'Get the full definition of a specific CDS entity including all fields with types, ' +
    'associations, compositions, and their ON conditions. Essential for understanding entity structure.',
  inputSchema: {
    type: 'object',
    properties: {
      entity: {
        type: 'string',
        description: 'Fully qualified entity name (e.g., "flights.Carriers" or just "Carriers")',
      },
    },
    required: ['entity'],
  },
  handler: async (args, cwd) => {
    const csn = await getCompiledModel(cwd);
    const model = JSON.parse(csn);
    const defs = model.definitions || {};

    // Find entity by exact name or suffix match
    let entityDef: any = null;
    let entityName = '';
    for (const [name, def] of Object.entries(defs) as Array<[string, any]>) {
      if (def.kind !== 'entity') continue;
      if (name === args.entity || name.endsWith(`.${args.entity}`)) {
        entityDef = def;
        entityName = name;
        break;
      }
    }

    if (!entityDef) return `Entity "${args.entity}" not found.`;

    return formatEntityDetail(entityName, entityDef);
  },
};

const capAssociations: ToolDefinition = {
  name: 'cap_associations',
  description:
    'List all associations and compositions across the entire CDS model or for a specific entity. ' +
    'Shows source entity, target entity, cardinality, and type (Association vs Composition).',
  inputSchema: {
    type: 'object',
    properties: {
      entity: {
        type: 'string',
        description: 'Filter to a specific entity (optional). If omitted, shows all.',
      },
    },
  },
  handler: async (args, cwd) => {
    const csn = await getCompiledModel(cwd);
    const model = JSON.parse(csn);
    const defs = model.definitions || {};

    const relations: Array<{
      source: string;
      field: string;
      type: string;
      target: string;
      cardinality: string;
    }> = [];

    for (const [name, def] of Object.entries(defs) as Array<[string, any]>) {
      if (def.kind !== 'entity') continue;
      if (args.entity && name !== args.entity && !name.endsWith(`.${args.entity}`)) continue;

      for (const [elemName, elem] of Object.entries(def.elements || {}) as Array<[string, any]>) {
        if (elem.type === 'cds.Association' || elem.type === 'cds.Composition') {
          const card = elem.cardinality;
          let cardStr = 'to one';
          if (card && card.max === '*') cardStr = 'to many';

          relations.push({
            source: name.split('.').pop() || name,
            field: elemName,
            type: elem.type === 'cds.Composition' ? 'Composition' : 'Association',
            target: (elem.target || '').split('.').pop() || elem.target,
            cardinality: cardStr,
          });
        }
      }
    }

    if (relations.length === 0) return 'No associations found.';

    const headers = ['Source', 'Field', 'Type', 'Target', 'Cardinality'];
    const rows = relations.map((r) => [r.source, r.field, r.type, r.target, r.cardinality]);

    return `## Associations & Compositions\n\n**Total:** ${relations.length}\n\n` + formatMarkdownTable(headers, rows);
  },
};

const capServices: ToolDefinition = {
  name: 'cap_services',
  description:
    'List all CDS service definitions with their paths, entity counts, and function/action counts.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (_args, cwd) => {
    const csn = await getCompiledModel(cwd);
    const model = JSON.parse(csn);
    return formatServiceList(model);
  },
};

// ─── Navigation Map Tool ────────────────────────────────────

const capNavMap: ToolDefinition = {
  name: 'cap_nav_map',
  description:
    'Returns the complete navigation graph of the CDS data model with SQL JOIN conditions. ' +
    'For every association and composition, shows: source SQL table, target SQL table, ' +
    'cardinality (to-one / to-many), type (association / composition), and the exact SQL JOIN ON clause. ' +
    'Call this FIRST when you need to write multi-table JOIN queries for cap_cql_query. ' +
    'Tables use underscore pattern: flights_Carriers, flights_Connections, flights_Flights, etc.',
  inputSchema: {
    type: 'object',
    properties: {
      entity: {
        type: 'string',
        description: 'Filter to a specific entity (e.g., "Carriers"). Omit for full navigation map.',
      },
    },
  },
  handler: async (args, cwd) => {
    const csn = await getCompiledModel(cwd);
    const model = JSON.parse(csn);
    const defs = model.definitions || {};

    const navMap = new Map<string, Array<{
      property: string;
      targetTable: string;
      cardinality: string;
      type: string;
      joinOn: string;
    }>>();

    for (const [name, def] of Object.entries(defs) as Array<[string, any]>) {
      if (def.kind !== 'entity') continue;

      // Skip service projections (e.g. FlightsService.Carriers)
      const parts = name.split('.');
      if (parts.length > 1) {
        const parentName = parts.slice(0, -1).join('.');
        const parent = defs[parentName];
        if (parent && parent.kind === 'service') continue;
      }

      if (args.entity && !name.endsWith(`.${args.entity}`) && name !== args.entity) continue;

      const sourceTable = name.replace(/\./g, '_');
      const edges: Array<{
        property: string;
        targetTable: string;
        cardinality: string;
        type: string;
        joinOn: string;
      }> = [];

      for (const [elemName, elem] of Object.entries(def.elements || {}) as Array<[string, any]>) {
        if (elem.type !== 'cds.Association' && elem.type !== 'cds.Composition') continue;

        const targetFqn = elem.target || '';
        const targetTable = targetFqn.replace(/\./g, '_');
        const card = elem.cardinality?.max === '*' ? 'to many' : 'to one';
        const relType = elem.type === 'cds.Composition' ? 'composition' : 'association';

        // Build SQL JOIN ON clause from CSN on-condition
        let joinOn = '';
        if (elem.on && Array.isArray(elem.on)) {
          const tokens: string[] = [];
          for (const token of elem.on) {
            if (typeof token === 'string') {
              tokens.push(token === '=' ? '=' : token === 'and' ? 'AND' : token.toUpperCase());
            } else if (token.ref) {
              if (token.ref.length === 1) {
                tokens.push(`${sourceTable}.${token.ref[0]}`);
              } else if (token.ref.length >= 2) {
                tokens.push(`${targetTable}.${token.ref[token.ref.length - 1]}`);
              }
            }
          }
          joinOn = tokens.join(' ');
        }

        edges.push({ property: elemName, targetTable, cardinality: card, type: relType, joinOn });
      }

      if (edges.length > 0) {
        navMap.set(sourceTable, edges);
      }
    }

    if (navMap.size === 0) return 'No navigation properties found.';

    return formatNavMap(navMap);
  },
};

// ─── Schema & Compilation Tools ─────────────────────────────

const capCompile: ToolDefinition = {
  name: 'cap_compile',
  description:
    'Compile CDS model to various output formats: json (CSN), edm/edmx (OData metadata), ' +
    'sql (DDL statements), hdbcds, hdbtable. Powerful for inspecting the compiled output.',
  inputSchema: {
    type: 'object',
    properties: {
      format: {
        type: 'string',
        description: 'Output format',
        enum: ['json', 'edm', 'edmx', 'sql', 'hdbcds', 'hdbtable', 'yaml'],
        default: 'json',
      },
      source: {
        type: 'string',
        description: 'Source CDS file to compile (default: entire project)',
      },
    },
  },
  handler: async (args, cwd) => {
    const format = args.format || 'json';
    const cmdArgs = ['--to', format];
    if (args.source) cmdArgs.unshift(args.source);

    const output = await executeCds('compile', cmdArgs, cwd);

    // Truncate very large outputs
    if (output.length > 50000) {
      return output.slice(0, 50000) + '\n\n... (truncated, output exceeds 50KB)';
    }
    return output;
  },
};

const capEdm: ToolDefinition = {
  name: 'cap_edm',
  description:
    'Generate OData V4 EDMX metadata for the service. Shows all EntitySets, NavigationPropertyBindings, ' +
    'EntityTypes with their properties — the full OData contract.',
  inputSchema: {
    type: 'object',
    properties: {
      service: {
        type: 'string',
        description: 'Service CDS file (default: auto-detected from srv/)',
      },
    },
  },
  handler: async (args, cwd) => {
    const source = args.service || '';
    const cmdArgs = source ? [source, '--to', 'edm'] : ['--to', 'edm'];
    const output = await executeCds('compile', cmdArgs, cwd);

    if (output.length > 50000) {
      return output.slice(0, 50000) + '\n\n... (truncated)';
    }
    return '## OData V4 Metadata (EDMX)\n\n```json\n' + output + '\n```';
  },
};

// ─── Data Inspection Tools ──────────────────────────────────

const capCsvInspect: ToolDefinition = {
  name: 'cap_csv_inspect',
  description:
    'Inspect CSV seed data files in the db/data/ directory. Lists available CSV files, ' +
    'row counts, and can preview the first N rows of a specific file.',
  inputSchema: {
    type: 'object',
    properties: {
      file: {
        type: 'string',
        description: 'Specific CSV filename to inspect (e.g., "flights-Carriers.csv"). If omitted, lists all files.',
      },
      rows: {
        type: 'number',
        description: 'Number of rows to preview (default: 5)',
        default: 5,
      },
    },
  },
  handler: async (args, cwd) => {
    if (args.file) {
      const output = await executeShell(`head -${(args.rows || 5) + 1} "db/data/${args.file}"`, cwd);
      const lines = output.trim().split('\n');
      if (lines.length === 0) return `File "${args.file}" is empty or not found.`;

      const headers = lines[0].split(';').length > 1
        ? lines[0].split(';')
        : lines[0].split(',');
      const dataRows = lines.slice(1).map((line) => {
        const sep = line.includes(';') ? ';' : ',';
        return line.split(sep);
      });

      return `## ${args.file}\n\n**Columns:** ${headers.length}\n**Preview rows:** ${dataRows.length}\n\n` +
        formatMarkdownTable(headers.map((h) => h.trim()), dataRows.map((r) => r.map((c) => c.trim())));
    }

    // List all CSV files with row counts
    const output = await executeShell('for f in db/data/*.csv; do echo "$(wc -l < "$f" | tr -d " ") $(basename "$f")"; done 2>/dev/null', cwd);
    if (!output.trim()) return 'No CSV files found in db/data/';

    const files = output.trim().split('\n').map((line) => {
      const [count, name] = line.trim().split(' ', 2);
      return [name || '', String(Math.max(0, parseInt(count || '0', 10) - 1)) + ' rows'];
    });

    return '## CSV Seed Data Files\n\n' + formatMarkdownTable(['File', 'Data Rows'], files);
  },
};

// ─── Project Management Tools ───────────────────────────────

const capProjectInfo: ToolDefinition = {
  name: 'cap_project_info',
  description:
    'Get comprehensive CAP project information: package.json metadata, CDS configuration, ' +
    'MTA modules, service bindings, and dependency versions.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (_args, cwd) => {
    const output = await executeCds('env', [], cwd);
    const pkgJson = await executeShell('cat package.json', cwd);

    let result = '## CAP Project Info\n\n';

    try {
      const pkg = JSON.parse(pkgJson);
      result += `**Name:** ${pkg.name}\n`;
      result += `**Version:** ${pkg.version}\n`;
      result += `**Description:** ${pkg.description || 'N/A'}\n\n`;

      result += '### Dependencies\n\n';
      for (const [dep, ver] of Object.entries(pkg.dependencies || {})) {
        result += `- ${dep}: ${ver}\n`;
      }
      result += '\n';
    } catch {
      result += '*Could not parse package.json*\n\n';
    }

    result += '### CDS Environment\n\n```\n' + output.slice(0, 10000) + '\n```';
    return result;
  },
};

const capMtaInfo: ToolDefinition = {
  name: 'cap_mta_info',
  description:
    'Parse and display the MTA deployment descriptor (mta.yaml). Shows modules, resources, ' +
    'service bindings, and deployment configuration.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (_args, cwd) => {
    const output = await executeShell('cat mta.yaml 2>/dev/null || echo "No mta.yaml found"', cwd);

    if (output.includes('No mta.yaml found')) return output;

    return '## MTA Deployment Descriptor\n\n```yaml\n' + output + '\n```';
  },
};

const capBuild: ToolDefinition = {
  name: 'cap_build',
  description:
    'Run CDS build (production or development). Compiles CDS models to deployment artifacts ' +
    '(hdbtable, hdbview, etc. for HANA; or sqlite for local).',
  inputSchema: {
    type: 'object',
    properties: {
      production: {
        type: 'boolean',
        description: 'Build for production (default: false)',
        default: false,
      },
    },
  },
  handler: async (args, cwd) => {
    const cmdArgs = args.production ? ['--production'] : [];
    const output = await executeShell(`npx cds build ${cmdArgs.join(' ')}`, cwd);
    return '## CDS Build Output\n\n```\n' + output + '\n```';
  },
};

// ─── HANA Bridge Tools (complement hana-cli) ───────────────

const capToHanaMapping: ToolDefinition = {
  name: 'cap_hana_mapping',
  description:
    'Show the mapping between CDS entities and their generated HANA artifacts (hdbtable/hdbview names). ' +
    'Bridges the gap between CDS model and hana-cli commands.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (_args, cwd) => {
    const csn = await getCompiledModel(cwd);
    const model = JSON.parse(csn);
    const defs = model.definitions || {};

    const mappings: Array<{ cds: string; hana: string; type: string }> = [];

    for (const [name, def] of Object.entries(defs) as Array<[string, any]>) {
      if (def.kind !== 'entity') continue;

      // CDS namespace.Entity → HANA namespace_Entity (dots become underscores)
      const hanaName = name.replace(/\./g, '_');
      const isView = !!def.query;

      mappings.push({
        cds: name,
        hana: hanaName,
        type: isView ? 'hdbview' : 'hdbtable',
      });
    }

    const headers = ['CDS Entity', 'HANA Artifact', 'Type'];
    const rows = mappings.map((m) => [m.cds, m.hana, m.type]);

    return `## CDS → HANA Mapping\n\n**Total artifacts:** ${mappings.length}\n\n` + formatMarkdownTable(headers, rows);
  },
};

const capQuery: ToolDefinition = {
  name: 'cap_query',
  description:
    'Execute a CQL or OData-style query against the running CAP service. ' +
    'Requires `cds watch` or `cds serve` to be running. ' +
    'Example: entity=Carriers, top=5, expand=CONNECTIONS',
  inputSchema: {
    type: 'object',
    properties: {
      entity: {
        type: 'string',
        description: 'Entity set name (e.g., "Carriers", "Flights")',
      },
      filter: {
        type: 'string',
        description: 'OData $filter expression (e.g., "CARRID eq \'LH\'")',
      },
      select: {
        type: 'string',
        description: 'OData $select fields (e.g., "CARRID,CARRNAME")',
      },
      expand: {
        type: 'string',
        description: 'OData $expand navigation (e.g., "CONNECTIONS,FLIGHTS")',
      },
      top: {
        type: 'number',
        description: 'Limit results (default: 10)',
        default: 10,
      },
      serviceUrl: {
        type: 'string',
        description: 'Base URL of running service (default: http://localhost:4004/odata/v4/flights)',
        default: 'http://localhost:4004/odata/v4/flights',
      },
    },
    required: ['entity'],
  },
  handler: async (args, cwd) => {
    const base = args.serviceUrl || 'http://localhost:4004/odata/v4/flights';
    let url = `${base}/${args.entity}?$top=${args.top || 10}`;

    if (args.filter) url += `&$filter=${encodeURIComponent(args.filter)}`;
    if (args.select) url += `&$select=${encodeURIComponent(args.select)}`;
    if (args.expand) url += `&$expand=${encodeURIComponent(args.expand)}`;

    try {
      const output = await executeShell(`curl -s "${url}"`, cwd);
      const data = JSON.parse(output);
      const count = data.value?.length ?? 0;

      return `## Query: ${args.entity}\n\n**Results:** ${count}\n\n\`\`\`json\n${JSON.stringify(data, null, 2).slice(0, 30000)}\n\`\`\``;
    } catch (error) {
      return `Query failed. Is the CAP server running? (cds watch)\n\nError: ${error}`;
    }
  },
};

// ─── Data Query Tools (SQL against in-memory SQLite) ────────

/**
 * Resolve the path to the query-runner.cjs script.
 * It ships alongside the MCP server build.
 */
function queryRunnerPath(): string {
  // Scripts live at mcp-server/scripts/, __dirname is mcp-server/build/
  return path.resolve(__dirname, '..', 'scripts', 'query-runner.cjs');
}

const capCqlQuery: ToolDefinition = {
  name: 'cap_cql_query',
  description:
    'Execute a SQL query against the CAP project database (in-memory SQLite with all CSV seed data loaded). ' +
    'Supports JOINs, GROUP BY, aggregations, subqueries — full SQLite SQL dialect. ' +
    'Tables: flights_Carriers, flights_Connections, flights_Flights, flights_Bookings, flights_Customers, ' +
    'flights_Planes, flights_CarrierPlanes, flights_Airports, flights_CityAirports, flights_GeoCities, ' +
    'flights_TravelAgencies, flights_Tickets, flights_Invoices, flights_BusinessPartners, flights_Counters, ' +
    'flights_Meals, flights_MealTexts, flights_Menus, flights_FlightMeals, flights_Starters, ' +
    'flights_MainCourses, flights_Desserts, flights_CurrencyRates, flights_CurrencyDecimals, ' +
    'flights_CargoPlanes, flights_PassengerPlanes. All tables have MANDT column. ' +
    'COMMON JOIN PATTERNS: ' +
    '(1) Carrier name for flights: f JOIN flights_Carriers c ON c.MANDT=f.MANDT AND c.CARRID=f.CARRID | ' +
    '(2) Route for flights: f JOIN flights_Connections cn ON cn.MANDT=f.MANDT AND cn.CARRID=f.CARRID AND cn.CONNID=f.CONNID | ' +
    '(3) Customer for bookings: b JOIN flights_Customers cu ON cu.MANDT=b.MANDT AND cu.ID=b.CUSTOMID | ' +
    '(4) Bookings for flights: f JOIN flights_Bookings b ON b.MANDT=f.MANDT AND b.CARRID=f.CARRID AND b.CONNID=f.CONNID AND b.FLDATE=f.FLDATE | ' +
    '(5) Fleet: flights_Carriers c JOIN flights_CarrierPlanes cp ON cp.MANDT=c.MANDT AND cp.CARRID=c.CARRID JOIN flights_Planes p ON p.MANDT=cp.MANDT AND p.PLANETYPE=cp.PLANETYPE | ' +
    '(6) Meals for connections: cn JOIN flights_FlightMeals fm ON fm.MANDT=cn.MANDT AND fm.CARRID=cn.CARRID AND fm.CONNID=cn.CONNID JOIN flights_Meals m ON m.MANDT=fm.MANDT AND m.CARRID=fm.CARRID AND m.MEALNUMBER=fm.MEALNUMBER | ' +
    '(7) 4-hop chain: flights_Carriers c JOIN flights_Connections cn ON cn.MANDT=c.MANDT AND cn.CARRID=c.CARRID JOIN flights_Flights f ON f.MANDT=cn.MANDT AND f.CARRID=cn.CARRID AND f.CONNID=cn.CONNID JOIN flights_Bookings b ON b.MANDT=f.MANDT AND b.CARRID=f.CARRID AND b.CONNID=f.CONNID AND b.FLDATE=f.FLDATE | ' +
    '(8) Airport info: cn JOIN flights_Airports a ON a.MANDT=cn.MANDT AND a.ID=cn.AIRPFROM | ' +
    '(9) Agency for bookings: b JOIN flights_TravelAgencies ta ON ta.MANDT=b.MANDT AND ta.AGENCYNUM=b.AGENCYNUM | ' +
    '(10) Tickets: b JOIN flights_Tickets t ON t.MANDT=b.MANDT AND t.CARRID=b.CARRID AND t.CONNID=b.CONNID AND t.FLDATE=b.FLDATE AND t.BOOKID=b.BOOKID. ' +
    'KEY COLUMNS: Flights(CARRID,CONNID,FLDATE,PRICE,CURRENCY,PLANETYPE,SEATSMAX,SEATSOCC,PAYMENTSUM,SEATSMAX_B,SEATSOCC_B,SEATSMAX_F,SEATSOCC_F) | ' +
    'Connections(CARRID,CONNID,CITYFROM,CITYTO,AIRPFROM,AIRPTO,COUNTRYFR,COUNTRYTO,DEPTIME,ARRTIME,DISTANCE,FLTIME) | ' +
    'Carriers(CARRID,CARRNAME,CURRCODE) | Bookings(CARRID,CONNID,FLDATE,BOOKID,CUSTOMID,CUSTTYPE,CLASS,FORCURAM,FORCURKEY,ORDER_DATE,CANCELLED,AGENCYNUM,PASSNAME) | ' +
    'Customers(ID,NAME,FORM,CITY,COUNTRY,CUSTTYPE,DISCOUNT,EMAIL) | Planes(PLANETYPE,SEATSMAX,PRODUCER,SEATSMAX_B,SEATSMAX_F) | Airports(ID,NAME,TIME_ZONE). ' +
    'DERIVED METRICS: occupancy_rate=CAST(SEATSOCC AS FLOAT)/SEATSMAX*100 | empty_seats=SEATSMAX-SEATSOCC | revenue_est=PRICE*SEATSOCC. ' +
    'DATE FUNCTIONS (SQLite): strftime("%Y",FLDATE) for year, strftime("%Y-%m",FLDATE) for month, FLDATE BETWEEN "2025-01-01" AND "2025-12-31". ' +
    'PRE-JOINED VIEWS (no JOINs needed): flights_FlightSchedule, flights_BookingDetails, flights_CarrierConnections, flights_CustomerBusinessPartners.',
  inputSchema: {
    type: 'object',
    properties: {
      sql: {
        type: 'string',
        description: 'SQL query to execute. Use table names from the description above.',
      },
      maxRows: {
        type: 'number',
        description: 'Maximum rows to return (default: 50, max: 500)',
        default: 50,
      },
    },
    required: ['sql'],
  },
  handler: async (args, cwd) => {
    const sql = args.sql.trim();
    const maxRows = Math.min(args.maxRows || 50, 500);
    const b64 = Buffer.from(sql).toString('base64');

    const output = await executeShell(
      `node "${queryRunnerPath()}" "${b64}" ${maxRows}`,
      cwd,
      15000
    );

    try {
      const result = JSON.parse(output.trim());
      if (result.error) return `**Query Error:** ${result.error}`;

      const { rows, count, truncated, query } = result;
      if (count === 0) return `No results for query:\n\`\`\`sql\n${query}\n\`\`\``;

      // Format as markdown table
      const headers = Object.keys(rows[0]);
      const tableRows = rows.map((r: any) =>
        headers.map((h) => {
          const v = r[h];
          return v === null ? 'NULL' : String(v);
        })
      );

      let md = `## Query Results\n\n**Rows:** ${count}${truncated ? ` (limited to ${maxRows})` : ''}\n\n`;
      md += '```sql\n' + query + '\n```\n\n';
      md += formatMarkdownTable(headers, tableRows);
      return md;
    } catch {
      return `**Raw output:**\n${output.slice(0, 5000)}`;
    }
  },
};

const capDataStats: ToolDefinition = {
  name: 'cap_data_stats',
  description:
    'Get row counts for all entities in the CAP project database. Shows which tables have data ' +
    'and how many rows each contains. Useful for understanding data volume and coverage before querying.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (_args, cwd) => {
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

      return `## Data Statistics\n\n**Total entities with data:** ${totalEntities}\n\n` +
        formatMarkdownTable(headers, rows);
    } catch {
      return `Raw output:\n${output.slice(0, 5000)}`;
    }
  },
};

const capSampleData: ToolDefinition = {
  name: 'cap_sample_data',
  description:
    'Preview sample rows from any entity in the database. Shows column names and actual data values. ' +
    'Useful for understanding data format, checking column values, and building queries. ' +
    'Accepts short names like "Carriers" or full names like "flights.Carriers".',
  inputSchema: {
    type: 'object',
    properties: {
      entity: {
        type: 'string',
        description: 'Entity name (e.g., "Carriers", "Flights", "Connections", "flights.Bookings")',
      },
      maxRows: {
        type: 'number',
        description: 'Number of sample rows (default: 5, max: 50)',
        default: 5,
      },
    },
    required: ['entity'],
  },
  handler: async (args, cwd) => {
    const maxRows = Math.min(args.maxRows || 5, 50);
    const output = await executeShell(
      `node "${queryRunnerPath()}" --sample "${args.entity}" ${maxRows}`,
      cwd,
      15000
    );

    try {
      const result = JSON.parse(output.trim());
      if (result.error) return result.error;

      const { entity, table, columns, rows, count } = result;
      const headers = columns || Object.keys(rows[0]);
      const tableRows = rows.map((r: any) =>
        headers.map((h: string) => {
          const v = r[h];
          return v === null ? 'NULL' : String(v);
        })
      );

      let md = `## ${entity}\n\n**Table:** \`${table}\`\n**Columns:** ${headers.join(', ')}\n**Showing:** ${count} rows\n\n`;
      md += formatMarkdownTable(headers, tableRows);
      return md;
    } catch {
      return `Raw output:\n${output.slice(0, 5000)}`;
    }
  },
};

const capDbSchema: ToolDefinition = {
  name: 'cap_db_schema',
  description:
    'List all database tables with column definitions (name, type, key status) AND relationship info ' +
    '(navigation properties with SQL JOIN ON clauses). Essential for building SQL queries — ' +
    'shows exact table names, column names, and how tables relate to each other.',
  inputSchema: {
    type: 'object',
    properties: {},
  },
  handler: async (_args, cwd) => {
    const output = await executeShell(
      `node "${queryRunnerPath()}" --schema`,
      cwd,
      15000
    );

    try {
      const result = JSON.parse(output.trim());
      if (result.error) return `Error: ${result.error}`;

      // Build relationship map from CSN
      const csn = await getCompiledModel(cwd);
      const model = JSON.parse(csn);
      const modelDefs = model.definitions || {};
      const relMap = new Map<string, Array<{ nav: string; targetTable: string; joinOn: string }>>();

      for (const [eName, eDef] of Object.entries(modelDefs) as Array<[string, any]>) {
        if (eDef.kind !== 'entity') continue;
        const eParts = eName.split('.');
        if (eParts.length > 1) {
          const parentName = eParts.slice(0, -1).join('.');
          if (modelDefs[parentName]?.kind === 'service') continue;
        }
        const srcTable = eName.replace(/\./g, '_');
        const rels: Array<{ nav: string; targetTable: string; joinOn: string }> = [];
        for (const [elName, el] of Object.entries(eDef.elements || {}) as Array<[string, any]>) {
          if (el.type !== 'cds.Association' && el.type !== 'cds.Composition') continue;
          const tgtTable = (el.target || '').replace(/\./g, '_');
          let joinOn = '';
          if (el.on && Array.isArray(el.on)) {
            const toks: string[] = [];
            for (const tok of el.on) {
              if (typeof tok === 'string') {
                toks.push(tok === '=' ? '=' : tok === 'and' ? 'AND' : tok.toUpperCase());
              } else if (tok.ref) {
                if (tok.ref.length === 1) toks.push(`${srcTable}.${tok.ref[0]}`);
                else toks.push(`${tgtTable}.${tok.ref[tok.ref.length - 1]}`);
              }
            }
            joinOn = toks.join(' ');
          }
          rels.push({ nav: elName, targetTable: tgtTable, joinOn });
        }
        if (rels.length > 0) relMap.set(srcTable, rels);
      }

      const { tables, totalTables } = result;
      let md = `## Database Schema\n\n**Total tables:** ${totalTables}\n\n`;

      for (const t of tables) {
        md += `### ${t.entity}${t.isView ? ' (view)' : ''}\n`;
        md += `**Table:** \`${t.table}\`\n\n`;

        const headers = ['Column', 'Type', 'Key'];
        const rows = t.columns.map((c: any) => [
          c.name,
          c.length ? `${c.type}(${c.length})` : c.type,
          c.key ? 'KEY' : '',
        ]);
        md += formatMarkdownTable(headers, rows);

        // Append relationship info if available
        const rels = relMap.get(t.table);
        if (rels && rels.length > 0) {
          md += '\n**Relationships:**\n';
          const relHeaders = ['Navigation', 'Target Table', 'SQL JOIN ON'];
          const relRows = rels.map(r => [r.nav, r.targetTable, r.joinOn]);
          md += formatMarkdownTable(relHeaders, relRows);
        }
        md += '\n';
      }

      return md;
    } catch {
      return `**Raw output:**\n${output.slice(0, 5000)}`;
    }
  },
};

// ─── Analytics Tools ────────────────────────────────────────

const capDataDistribution: ToolDefinition = {
  name: 'cap_data_distribution',
  description:
    'Analyze data distribution by grouping any entity column and counting rows. ' +
    'Perfect for year-wise counts, category breakdowns, status distributions, etc. ' +
    'Examples: Flights by year, Bookings by class, Carriers by currency, ' +
    'Flights by airline, Bookings by travel agency. ' +
    'Can optionally apply a SQL expression to transform the group column ' +
    '(e.g., substr(FLDATE,1,4) to group by year, or substr(FLDATE,1,7) for month).',
  inputSchema: {
    type: 'object',
    properties: {
      entity: {
        type: 'string',
        description: 'Entity name (e.g., "Flights", "Bookings", "Carriers")',
      },
      groupBy: {
        type: 'string',
        description: 'Column name or SQL expression to group by (e.g., "CARRID", "CLASS", "substr(FLDATE,1,4)")',
      },
      label: {
        type: 'string',
        description: 'Optional label for the group column in output (e.g., "Year", "Airline")',
      },
      orderBy: {
        type: 'string',
        description: 'Order results: "group" (by group value, default), "count_desc" (most first), "count_asc" (least first)',
        default: 'group',
      },
      filter: {
        type: 'string',
        description: 'Optional WHERE clause (without WHERE keyword). E.g., "MANDT = \'000\'" or "PRICE > 500"',
      },
      includePercent: {
        type: 'boolean',
        description: 'Include percentage column (default: true)',
        default: true,
      },
    },
    required: ['entity', 'groupBy'],
  },
  handler: async (args, cwd) => {
    const entity = args.entity.includes('_') ? args.entity : `flights_${args.entity}`;
    const groupExpr = args.groupBy;
    const label = args.label || args.groupBy;
    const showPct = args.includePercent !== false;

    let orderClause: string;
    switch (args.orderBy) {
      case 'count_desc': orderClause = 'COUNT(*) DESC'; break;
      case 'count_asc': orderClause = 'COUNT(*) ASC'; break;
      default: orderClause = 'grp'; break;
    }

    const where = args.filter ? `WHERE ${args.filter}` : '';

    const sql = showPct
      ? `SELECT ${groupExpr} as grp, COUNT(*) as count, ROUND(COUNT(*) * 100.0 / (SELECT COUNT(*) FROM ${entity} ${where}), 1) as pct FROM ${entity} ${where} GROUP BY grp ORDER BY ${orderClause}`
      : `SELECT ${groupExpr} as grp, COUNT(*) as count FROM ${entity} ${where} GROUP BY grp ORDER BY ${orderClause}`;

    const b64 = Buffer.from(sql).toString('base64');
    const output = await executeShell(
      `node "${queryRunnerPath()}" "${b64}" 200`,
      cwd,
      15000
    );

    try {
      const result = JSON.parse(output.trim());
      if (result.error) return `**Error:** ${result.error}`;

      const { rows, count } = result;
      if (count === 0) return `No data found in ${entity}.`;

      const total = rows.reduce((s: number, r: any) => s + r.count, 0);
      const headers = showPct ? [label, 'Count', '%'] : [label, 'Count'];
      const tableRows = rows.map((r: any) =>
        showPct
          ? [String(r.grp), String(r.count), `${r.pct}%`]
          : [String(r.grp), String(r.count)]
      );

      let md = `## ${args.entity} — Distribution by ${label}\n\n`;
      md += `**Total rows:** ${total.toLocaleString()} across ${count} groups\n\n`;
      md += formatMarkdownTable(headers, tableRows);
      return md;
    } catch {
      return `**Raw output:**\n${output.slice(0, 5000)}`;
    }
  },
};

const capYoYGrowth: ToolDefinition = {
  name: 'cap_yoy_growth',
  description:
    'Calculate year-over-year growth for any entity. Shows count per year and % change from previous year. ' +
    'Uses FLDATE by default for date column, but can use any date column. ' +
    'Great for trend analysis: flight growth, booking trends, revenue growth.',
  inputSchema: {
    type: 'object',
    properties: {
      entity: {
        type: 'string',
        description: 'Entity name (e.g., "Flights", "Bookings")',
      },
      dateColumn: {
        type: 'string',
        description: 'Date column to extract year from (default: "FLDATE")',
        default: 'FLDATE',
      },
      metric: {
        type: 'string',
        description: 'Optional aggregation instead of COUNT. E.g., "SUM(PRICE)" for revenue, "AVG(SEATSOCC)" for avg occupancy',
      },
      metricLabel: {
        type: 'string',
        description: 'Label for the metric column (default: "Count" or derived from metric)',
      },
      filter: {
        type: 'string',
        description: 'Optional WHERE clause (without WHERE keyword)',
      },
    },
    required: ['entity'],
  },
  handler: async (args, cwd) => {
    const entity = args.entity.includes('_') ? args.entity : `flights_${args.entity}`;
    const dateCol = args.dateColumn || 'FLDATE';
    const metric = args.metric || 'COUNT(*)';
    const metricLabel = args.metricLabel || (args.metric ? args.metric : 'Count');
    const where = args.filter ? `WHERE ${args.filter}` : '';

    const sql = `SELECT substr(${dateCol},1,4) as Year, ${metric} as val FROM ${entity} ${where} GROUP BY substr(${dateCol},1,4) ORDER BY Year`;
    const b64 = Buffer.from(sql).toString('base64');
    const output = await executeShell(
      `node "${queryRunnerPath()}" "${b64}" 50`,
      cwd,
      15000
    );

    try {
      const result = JSON.parse(output.trim());
      if (result.error) return `**Error:** ${result.error}`;
      const { rows } = result;
      if (rows.length === 0) return `No data found.`;

      // Calculate YoY growth
      const enriched = rows.map((r: any, i: number) => {
        const prev = i > 0 ? rows[i - 1].val : null;
        const growth = prev ? ((r.val - prev) / prev * 100).toFixed(1) : '—';
        return { year: r.Year, val: r.val, growth };
      });

      const headers = ['Year', metricLabel, 'YoY Growth'];
      const tableRows = enriched.map((r: any) => [
        r.year,
        typeof r.val === 'number' ? r.val.toLocaleString() : String(r.val),
        r.growth === '—' ? '—' : `${r.growth}%`,
      ]);

      let md = `## ${args.entity} — Year-over-Year Growth\n\n`;
      md += `**Metric:** ${metricLabel} by ${dateCol}\n\n`;
      md += formatMarkdownTable(headers, tableRows);
      return md;
    } catch {
      return `**Raw output:**\n${output.slice(0, 5000)}`;
    }
  },
};

// ─── Export all tools ────────────────────────────────────────

export const ALL_TOOLS: ToolDefinition[] = [
  // Model introspection
  capEntities,
  capEntityDetail,
  capAssociations,
  capNavMap,
  capServices,
  // Schema & compilation
  capCompile,
  capEdm,
  // Data inspection
  capCsvInspect,
  // Project management
  capProjectInfo,
  capMtaInfo,
  capBuild,
  // HANA bridge
  capToHanaMapping,
  // Data query (SQL against in-memory SQLite)
  capCqlQuery,
  capDataStats,
  capSampleData,
  capDbSchema,
  // Analytics
  capDataDistribution,
  capYoYGrowth,
  // OData live query (requires running server)
  capQuery,
];
