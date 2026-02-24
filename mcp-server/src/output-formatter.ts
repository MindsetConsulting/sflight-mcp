/**
 * Output Formatter for CAP MCP Server
 *
 * Converts CDS model data into clean markdown for LLM consumption.
 * Unlike hana-cli's formatter (which parses ASCII box-drawing tables),
 * this works directly with structured data since we parse JSON in-process.
 */

/**
 * Format data as a markdown table
 */
export function formatMarkdownTable(headers: string[], rows: string[][]): string {
  if (headers.length === 0) return '';

  // Calculate column widths
  const widths = headers.map((h, i) => {
    const cellLengths = rows.map((r) => (r[i] || '').length);
    const maxCell = cellLengths.length > 0 ? Math.max(...cellLengths) : 0;
    return Math.max(h.length, maxCell, 3); // min width 3
  });

  let output = '| ' + headers.map((h, i) => h.padEnd(widths[i])).join(' | ') + ' |\n';
  output += '| ' + widths.map((w) => '-'.repeat(w)).join(' | ') + ' |\n';

  for (const row of rows) {
    output += '| ' + row.map((cell, i) => (cell || '').padEnd(widths[i] || 0)).join(' | ') + ' |\n';
  }

  return output;
}

/**
 * Format a single entity's full detail from CSN
 */
export function formatEntityDetail(name: string, def: any): string {
  const elements = def.elements || {};
  const isView = !!def.query;

  let result = `## ${name}\n\n`;
  result += `**Kind:** ${isView ? 'view' : 'entity'}\n\n`;

  // Fields table
  const fields: string[][] = [];
  const assocs: string[][] = [];

  for (const [elemName, elem] of Object.entries(elements) as Array<[string, any]>) {
    if (elem.type === 'cds.Association' || elem.type === 'cds.Composition') {
      const card = elem.cardinality;
      const cardStr = card && card.max === '*' ? 'to many' : 'to one';
      const target = (elem.target || '').split('.').pop() || elem.target;
      const relType = elem.type === 'cds.Composition' ? 'Composition' : 'Association';

      // Extract ON condition
      let onCondition = '';
      if (elem.on) {
        onCondition = formatOnCondition(elem.on);
      }

      assocs.push([elemName, relType, cardStr, target, onCondition]);
    } else {
      const keyMarker = elem.key ? 'KEY' : '';
      const notNull = elem.notNull ? 'NOT NULL' : '';
      const typeStr = formatCdsType(elem);
      fields.push([elemName, typeStr, keyMarker, notNull]);
    }
  }

  if (fields.length > 0) {
    result += '### Fields\n\n';
    result += formatMarkdownTable(['Name', 'Type', 'Key', 'Constraint'], fields);
    result += '\n';
  }

  if (assocs.length > 0) {
    result += '### Relationships\n\n';
    result += formatMarkdownTable(['Name', 'Type', 'Cardinality', 'Target', 'ON Condition'], assocs);
    result += '\n';
  }

  return result;
}

/**
 * Format CDS type from CSN element
 */
function formatCdsType(elem: any): string {
  const type = elem.type || 'unknown';

  // Map CDS types to readable names
  const typeMap: Record<string, string> = {
    'cds.String': 'String',
    'cds.Integer': 'Integer',
    'cds.Integer64': 'Integer64',
    'cds.Decimal': 'Decimal',
    'cds.Double': 'Double',
    'cds.Date': 'Date',
    'cds.Time': 'Time',
    'cds.DateTime': 'DateTime',
    'cds.Timestamp': 'Timestamp',
    'cds.Boolean': 'Boolean',
    'cds.UUID': 'UUID',
    'cds.LargeString': 'LargeString',
    'cds.LargeBinary': 'LargeBinary',
  };

  let result = typeMap[type] || type;

  if (elem.length) result += `(${elem.length})`;
  if (elem.precision !== undefined && elem.scale !== undefined) {
    result += `(${elem.precision}, ${elem.scale})`;
  }

  return result;
}

/**
 * Format ON condition from CSN
 */
function formatOnCondition(on: any[]): string {
  if (!Array.isArray(on)) return '';

  const parts: string[] = [];
  for (const item of on) {
    if (typeof item === 'string') {
      parts.push(item === '=' ? '=' : item === 'and' ? 'AND' : item);
    } else if (item.ref) {
      parts.push(item.ref.join('.'));
    }
  }

  return parts.join(' ');
}

/**
 * Format service list from CSN model
 */
/**
 * Format navigation map — associations/compositions with SQL JOIN conditions
 */
export function formatNavMap(
  navMap: Map<string, Array<{
    property: string;
    targetTable: string;
    cardinality: string;
    type: string;
    joinOn: string;
  }>>
): string {
  let totalEdges = 0;
  for (const edges of navMap.values()) totalEdges += edges.length;

  let md = `## Navigation Map (${totalEdges} relationships)\n\n`;
  md += `Use these JOIN conditions with \`cap_cql_query\`.\n\n`;

  for (const [sourceTable, edges] of navMap) {
    md += `### ${sourceTable}\n\n`;
    const headers = ['Nav Property', 'Target Table', 'Card.', 'Type', 'SQL JOIN ON'];
    const rows = edges.map(e => [e.property, e.targetTable, e.cardinality, e.type, e.joinOn]);
    md += formatMarkdownTable(headers, rows) + '\n';
  }

  return md;
}

/**
 * Format service list from CSN model
 */
export function formatServiceList(model: any): string {
  const defs = model.definitions || {};

  const services: Array<{
    name: string;
    path: string;
    entities: number;
    functions: number;
    actions: number;
  }> = [];

  for (const [name, def] of Object.entries(defs) as Array<[string, any]>) {
    if (def.kind !== 'service') continue;

    let entityCount = 0;
    let functionCount = 0;
    let actionCount = 0;

    // Count service members
    for (const [memberName, memberDef] of Object.entries(defs) as Array<[string, any]>) {
      if (!memberName.startsWith(name + '.')) continue;
      if (memberDef.kind === 'entity') entityCount++;
      if (memberDef.kind === 'function') functionCount++;
      if (memberDef.kind === 'action') actionCount++;
    }

    // Extract path annotation
    const annotations = def['@'] || {};
    const path = def['@path'] || annotations['path'] || `/${name.replace(/\./g, '/')}`;

    services.push({
      name,
      path: typeof path === 'string' ? path : String(path),
      entities: entityCount,
      functions: functionCount,
      actions: actionCount,
    });
  }

  if (services.length === 0) return 'No services found.';

  let result = `## CDS Services\n\n**Total:** ${services.length}\n\n`;

  for (const svc of services) {
    result += `### ${svc.name}\n\n`;
    result += `- **Path:** ${svc.path}\n`;
    result += `- **Entities:** ${svc.entities}\n`;
    result += `- **Functions:** ${svc.functions}\n`;
    result += `- **Actions:** ${svc.actions}\n\n`;
  }

  return result;
}
