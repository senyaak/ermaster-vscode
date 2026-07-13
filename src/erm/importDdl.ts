import { ErmColumn, ErmDiagram, ErmTable, expandedColumns } from './model';
import { addColumn, addTable, columnName, createRelation, emptyDiagram } from './ops';

/**
 * Basic DDL import: parses CREATE TABLE / ALTER TABLE ... FOREIGN KEY
 * statements (PostgreSQL/MySQL style) into a fresh diagram, laying tables
 * out on a grid. Not a full SQL parser — quoted identifiers, common column
 * flags and constraints are supported; everything else is skipped.
 */
export function importDdl(sql: string, database = 'PostgreSQL'): ErmDiagram {
  const diagram = emptyDiagram(database);
  const text = stripComments(sql);
  const statements = splitStatements(text);

  const tablesByName = new Map<string, ErmTable>();
  const pendingFks: {
    table: string;
    columns: string[];
    refTable: string;
    refColumns: string[];
    onDelete?: string;
    onUpdate?: string;
    name?: string;
  }[] = [];

  let tableCount = 0;
  for (const stmt of statements) {
    const create = /^create\s+table\s+(?:if\s+not\s+exists\s+)?(\S+?)\s*\(/is.exec(stmt);
    if (create) {
      const name = unquote(create[1]);
      const bodyStart = stmt.indexOf('(', create.index);
      const body = extractParens(stmt, bodyStart);
      if (body === null) {
        continue;
      }
      const x = 60 + (tableCount % 4) * 280;
      const y = 60 + Math.floor(tableCount / 4) * 240;
      tableCount++;

      const table = addTable(diagram, x, y);
      table.columns = []; // no implicit id column on import
      table.physicalName = name;
      table.logicalName = name;
      tablesByName.set(name.toLowerCase(), table);

      for (const item of splitTopLevel(body)) {
        parseTableItem(item.trim(), table, name, pendingFks);
      }
      continue;
    }

    const alter =
      /^alter\s+table\s+(?:only\s+)?(\S+?)\s+add\s+(?:constraint\s+(\S+)\s+)?foreign\s+key\s*\(([^)]*)\)\s*references\s+(\S+?)\s*\(([^)]*)\)(.*)$/is.exec(
        stmt,
      );
    if (alter) {
      pendingFks.push({
        table: unquote(alter[1]),
        name: alter[2] ? unquote(alter[2]) : undefined,
        columns: splitIdents(alter[3]),
        refTable: unquote(alter[4]),
        refColumns: splitIdents(alter[5]),
        ...parseActions(alter[6] ?? ''),
      });
    }
  }

  // resolve FKs
  for (const fk of pendingFks) {
    const child = tablesByName.get(fk.table.toLowerCase());
    const parent = tablesByName.get(fk.refTable.toLowerCase());
    if (!child || !parent) {
      continue;
    }
    for (let i = 0; i < fk.columns.length; i++) {
      const childCol = findColumn(child, fk.columns[i]);
      const parentCol = fk.refColumns[i]
        ? findColumn(parent, fk.refColumns[i])
        : expandedColumns(parent).find((c) => c.primaryKey === 'true') ?? null;
      if (!childCol || !parentCol) {
        continue;
      }
      const rel = createRelation(diagram, child, childCol, parent, parentCol);
      if (fk.name) {
        rel.name = fk.name;
      }
      if (fk.onDelete) {
        rel.onDeleteAction = fk.onDelete.toUpperCase();
      }
      if (fk.onUpdate) {
        rel.onUpdateAction = fk.onUpdate.toUpperCase();
      }
    }
  }

  return diagram;
}

function parseTableItem(
  item: string,
  table: ErmTable,
  tableName: string,
  pendingFks: {
    table: string;
    columns: string[];
    refTable: string;
    refColumns: string[];
    onDelete?: string;
    onUpdate?: string;
    name?: string;
  }[],
): void {
  if (!item) {
    return;
  }

  const constraint = /^constraint\s+(\S+)\s+(.*)$/is.exec(item);
  const constraintName = constraint ? unquote(constraint[1]) : undefined;
  const rest = constraint ? constraint[2] : item;

  const pk = /^primary\s+key\s*\(([^)]*)\)/i.exec(rest);
  if (pk) {
    for (const name of splitIdents(pk[1])) {
      const col = findColumn(table, name);
      if (col) {
        col.primaryKey = 'true';
        col.notNull = 'true';
      }
    }
    if (constraintName) {
      table.primaryKeyName = constraintName;
    }
    return;
  }

  const unique = /^unique\s*(?:key\s+\S+\s*)?\(([^)]*)\)/i.exec(rest);
  if (unique) {
    const cols = splitIdents(unique[1])
      .map((n) => findColumn(table, n))
      .filter((c): c is ErmColumn => !!c);
    if (cols.length === 1) {
      cols[0].uniqueKey = 'true';
    } else if (cols.length > 1) {
      table.complexUniqueKeys.push({ name: constraintName ?? '', columns: cols });
    }
    return;
  }

  const fk = /^foreign\s+key\s*\(([^)]*)\)\s*references\s+(\S+?)\s*\(([^)]*)\)(.*)$/is.exec(rest);
  if (fk) {
    pendingFks.push({
      table: tableName,
      name: constraintName,
      columns: splitIdents(fk[1]),
      refTable: unquote(fk[2]),
      refColumns: splitIdents(fk[3]),
      ...parseActions(fk[4] ?? ''),
    });
    return;
  }

  if (/^(index|key|check|constraint|exclude)\b/i.test(rest)) {
    return; // inline indexes/checks — skipped
  }

  parseColumnDef(item, table);
}

function parseColumnDef(item: string, table: ErmTable): void {
  const m = /^("[^"]+"|`[^`]+`|\[[^\]]+\]|\S+)\s+(.*)$/s.exec(item);
  if (!m) {
    return;
  }
  const name = unquote(m[1]);
  let rest = m[2].trim();

  const typeMatch = /^([a-z_0-9]+(?:\s+precision|\s+varying)?(?:\s*\(\s*\d+\s*(?:,\s*\d+\s*)?\))?)/i.exec(rest);
  const type = typeMatch ? typeMatch[1].replace(/\s+/g, ' ').toLowerCase() : 'varchar(255)';
  rest = rest.slice(typeMatch ? typeMatch[0].length : 0);

  const col = addColumn(table, name, type);
  if (/\bnot\s+null\b/i.test(rest)) {
    col.notNull = 'true';
  }
  if (/\bunique\b/i.test(rest)) {
    col.uniqueKey = 'true';
  }
  if (/\bprimary\s+key\b/i.test(rest)) {
    col.primaryKey = 'true';
    col.notNull = 'true';
  }
  if (/\bauto_increment\b/i.test(rest)) {
    col.autoIncrement = 'true';
  }
  const def = /\bdefault\s+((?:'[^']*')|(?:[^\s,]+(?:\(\))?))/i.exec(rest);
  if (def) {
    col.defaultValue = def[1];
  }
  const comment = /\bcomment\s+'([^']*)'/i.exec(rest);
  if (comment && col.word) {
    col.word.description = comment[1];
  }
}

// ------------------------------------------------------------ text utils

function stripComments(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '');
}

function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  let inString = false;
  for (const ch of sql) {
    if (inString) {
      current += ch;
      if (ch === "'") {
        inString = false;
      }
      continue;
    }
    if (ch === "'") {
      inString = true;
      current += ch;
    } else if (ch === '(') {
      depth++;
      current += ch;
    } else if (ch === ')') {
      depth--;
      current += ch;
    } else if (ch === ';' && depth === 0) {
      if (current.trim()) {
        out.push(current.trim());
      }
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    out.push(current.trim());
  }
  return out;
}

function extractParens(text: string, openIndex: number): string | null {
  let depth = 0;
  let inString = false;
  for (let i = openIndex; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (ch === "'") {
        inString = false;
      }
      continue;
    }
    if (ch === "'") {
      inString = true;
    } else if (ch === '(') {
      depth++;
    } else if (ch === ')') {
      depth--;
      if (depth === 0) {
        return text.slice(openIndex + 1, i);
      }
    }
  }
  return null;
}

function splitTopLevel(body: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current = '';
  let inString = false;
  for (const ch of body) {
    if (inString) {
      current += ch;
      if (ch === "'") {
        inString = false;
      }
      continue;
    }
    if (ch === "'") {
      inString = true;
      current += ch;
    } else if (ch === '(') {
      depth++;
      current += ch;
    } else if (ch === ')') {
      depth--;
      current += ch;
    } else if (ch === ',' && depth === 0) {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  if (current.trim()) {
    out.push(current);
  }
  return out;
}

function unquote(name: string): string {
  return name.trim().replace(/^["`[]|["`\]]$/g, '');
}

function splitIdents(list: string): string[] {
  return list
    .split(',')
    .map((s) => unquote(s))
    .filter(Boolean);
}

function parseActions(tail: string): { onDelete?: string; onUpdate?: string } {
  const out: { onDelete?: string; onUpdate?: string } = {};
  const del = /on\s+delete\s+(cascade|set\s+null|set\s+default|restrict|no\s+action)/i.exec(tail);
  if (del) {
    out.onDelete = del[1].replace(/\s+/g, ' ');
  }
  const upd = /on\s+update\s+(cascade|set\s+null|set\s+default|restrict|no\s+action)/i.exec(tail);
  if (upd) {
    out.onUpdate = upd[1].replace(/\s+/g, ' ');
  }
  return out;
}

function findColumn(table: ErmTable, name: string): ErmColumn | null {
  const lower = name.toLowerCase();
  return expandedColumns(table).find((c) => columnName(c).toLowerCase() === lower) ?? null;
}
