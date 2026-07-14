import { ErmDiagram, ErmTable, expandedColumns, isTable } from './erm/model';
import { columnName, formatType } from './erm/ops';
import { str } from './erm/xml';

export type Dialect = 'PostgreSQL' | 'MySQL' | 'Oracle' | 'SQLServer' | 'SQLite' | 'StandardSQL';

export function dialectOf(diagram: ErmDiagram): Dialect {
  const db = diagram.settings.database;
  switch (db) {
    case 'MySQL':
      return 'MySQL';
    case 'PostgreSQL':
      return 'PostgreSQL';
    case 'Oracle':
      return 'Oracle';
    case 'SQLServer':
    case 'SQLServer 2008':
      return 'SQLServer';
    case 'SQLite':
      return 'SQLite';
    default:
      return 'StandardSQL';
  }
}

interface DialectRules {
  quote(name: string): string;
  mapType(type: string, autoIncrement: boolean): string;
  inlineAutoIncrement: string;
  supportsCommentOn: boolean;
  inlineComment: boolean;
  supportsSequences: boolean;
}

const RULES: Record<Dialect, DialectRules> = {
  PostgreSQL: {
    quote: (n) => '"' + n.replace(/"/g, '""') + '"',
    mapType: (t) => t,
    inlineAutoIncrement: '',
    supportsCommentOn: true,
    inlineComment: false,
    supportsSequences: true,
  },
  MySQL: {
    quote: (n) => '`' + n.replace(/`/g, '``') + '`',
    mapType: (t, autoIncrement) => {
      const map: Record<string, string> = {
        serial: 'int',
        bigserial: 'bigint',
        bytea: 'blob',
        timestamptz: 'timestamp',
        timetz: 'time',
        boolean: 'tinyint(1)',
        uuid: 'char(36)',
        'double precision': 'double',
      };
      void autoIncrement;
      return map[t] ?? t;
    },
    inlineAutoIncrement: ' AUTO_INCREMENT',
    supportsCommentOn: false,
    inlineComment: true,
    supportsSequences: false,
  },
  Oracle: {
    quote: (n) => '"' + n.replace(/"/g, '""') + '"',
    mapType: (t) => {
      const m = /^([a-z_ ]+)(\(.*\))?$/i.exec(t);
      const base = (m?.[1] ?? t).trim().toLowerCase();
      const args = m?.[2] ?? '';
      const map: Record<string, string> = {
        varchar: `VARCHAR2${args || '(255)'}`,
        'varchar(max)': 'CLOB',
        text: 'CLOB',
        clob: 'CLOB',
        int: 'NUMBER(10)',
        integer: 'NUMBER(10)',
        serial: 'NUMBER(10)',
        smallint: 'NUMBER(5)',
        bigint: 'NUMBER(19)',
        bigserial: 'NUMBER(19)',
        boolean: 'NUMBER(1)',
        'double precision': 'BINARY_DOUBLE',
        double: 'BINARY_DOUBLE',
        real: 'BINARY_FLOAT',
        float: 'BINARY_FLOAT',
        bytea: 'BLOB',
        blob: 'BLOB',
        uuid: 'RAW(16)',
        timestamptz: 'TIMESTAMP WITH TIME ZONE',
        datetime: 'TIMESTAMP',
      };
      return map[t] ?? map[base] ?? t.toUpperCase();
    },
    inlineAutoIncrement: '', // Oracle uses sequences (+ triggers) for auto-increment
    supportsCommentOn: true,
    inlineComment: false,
    supportsSequences: true,
  },
  SQLServer: {
    quote: (n) => '[' + n.replace(/]/g, ']]') + ']',
    mapType: (t) => {
      const m = /^([a-z_ ]+)(\(.*\))?$/i.exec(t);
      const base = (m?.[1] ?? t).trim().toLowerCase();
      const args = m?.[2] ?? '';
      const map: Record<string, string> = {
        serial: 'INT',
        bigserial: 'BIGINT',
        integer: 'INT',
        boolean: 'BIT',
        text: 'VARCHAR(MAX)',
        clob: 'VARCHAR(MAX)',
        'varchar(max)': 'VARCHAR(MAX)',
        bytea: 'VARBINARY(MAX)',
        blob: 'VARBINARY(MAX)',
        uuid: 'UNIQUEIDENTIFIER',
        timestamp: 'DATETIME2',
        timestamptz: 'DATETIMEOFFSET',
        'double precision': 'FLOAT',
        double: 'FLOAT',
      };
      if (map[t]) return map[t];
      if (map[base]) return map[base] + (base === 'varchar' ? args : '');
      return t;
    },
    inlineAutoIncrement: ' IDENTITY(1,1)',
    supportsCommentOn: false, // uses sp_addextendedproperty; skipped
    inlineComment: false,
    supportsSequences: false,
  },
  SQLite: {
    quote: (n) => '"' + n.replace(/"/g, '""') + '"',
    mapType: (t) => {
      const base = (/^([a-z_ ]+)/i.exec(t)?.[1] ?? t).trim().toLowerCase();
      const map: Record<string, string> = {
        serial: 'INTEGER',
        bigserial: 'INTEGER',
        int: 'INTEGER',
        bigint: 'INTEGER',
        smallint: 'INTEGER',
        boolean: 'INTEGER',
        'double precision': 'REAL',
        double: 'REAL',
        float: 'REAL',
        bytea: 'BLOB',
        uuid: 'TEXT',
        timestamptz: 'TEXT',
      };
      return map[t] ?? map[base] ?? t;
    },
    inlineAutoIncrement: '', // INTEGER PRIMARY KEY is implicitly a rowid alias
    supportsCommentOn: false,
    inlineComment: false,
    supportsSequences: false,
  },
  StandardSQL: {
    quote: (n) => '"' + n.replace(/"/g, '""') + '"',
    mapType: (t) => t,
    inlineAutoIncrement: '',
    supportsCommentOn: true,
    inlineComment: false,
    supportsSequences: true,
  },
};

function sqlString(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}

/** Generate DDL from a .erm diagram for the given (or the file's own) dialect. */
export function generateDdl(diagram: ErmDiagram, dialect?: Dialect): string {
  const d = dialect ?? dialectOf(diagram);
  const r = RULES[d];
  const q = r.quote;
  const parts: string[] = [];
  const tables = diagram.contents.filter(isTable);

  // sequences first (they may be referenced by defaults)
  if (r.supportsSequences) {
    for (const seq of diagram.sequences) {
      const name = str(seq, 'name');
      if (!name) {
        continue;
      }
      let stmt = `CREATE SEQUENCE ${q(name)}`;
      const inc = str(seq, 'increment');
      const start = str(seq, 'start');
      const minV = str(seq, 'min_value');
      const maxV = str(seq, 'max_value');
      if (inc) stmt += ` INCREMENT ${inc}`;
      if (minV) stmt += ` MINVALUE ${minV}`;
      if (maxV) stmt += ` MAXVALUE ${maxV}`;
      if (start) stmt += ` START ${start}`;
      if (str(seq, 'cycle') === 'true') stmt += ' CYCLE';
      parts.push(stmt + ';');
    }
  }

  for (const table of tables) {
    parts.push(createTable(table, d));
  }

  // FKs afterwards so table order doesn't matter
  for (const table of tables) {
    for (const conn of table.base.incomings) {
      if (conn.kind !== 'relation' || !conn.source || conn.source.kind !== 'table') {
        continue;
      }
      const parent = conn.source;
      const fkColumns = expandedColumns(table).filter((c) => c.relations.includes(conn));
      if (fkColumns.length === 0) {
        continue;
      }
      const parentColumns = expandedColumns(parent);
      const referenced = fkColumns.map(
        (c) => c.referencedColumns.find((rc) => parentColumns.includes(rc)) ?? c.referencedColumns[0],
      );
      const name = conn.name || `fk_${table.physicalName}_${columnName(fkColumns[0])}`;
      let stmt =
        `ALTER TABLE ${q(table.physicalName)} ADD CONSTRAINT ${q(name)}\n` +
        `  FOREIGN KEY (${fkColumns.map((c) => q(columnName(c))).join(', ')})` +
        ` REFERENCES ${q(parent.physicalName)} (${referenced.map((c) => q(columnName(c))).join(', ')})`;
      if (conn.onDeleteAction && conn.onDeleteAction !== 'RESTRICT' && conn.onDeleteAction !== 'NO ACTION') {
        stmt += ` ON DELETE ${conn.onDeleteAction}`;
      }
      if (conn.onUpdateAction && conn.onUpdateAction !== 'RESTRICT' && conn.onUpdateAction !== 'NO ACTION') {
        stmt += ` ON UPDATE ${conn.onUpdateAction}`;
      }
      parts.push(stmt + ';');
    }
  }

  // comments (dialects with COMMENT ON; MySQL gets them inline in CREATE TABLE)
  if (r.supportsCommentOn) {
    for (const table of tables) {
      const tableComment = table.description || table.logicalName;
      if (tableComment && tableComment !== table.physicalName) {
        parts.push(`COMMENT ON TABLE ${q(table.physicalName)} IS ${sqlString(tableComment)};`);
      }
      for (const col of expandedColumns(table)) {
        const comment = col.description || col.word?.description;
        if (comment) {
          parts.push(`COMMENT ON COLUMN ${q(table.physicalName)}.${q(columnName(col))} IS ${sqlString(comment)};`);
        }
      }
    }
  }

  // indexes
  for (const table of tables) {
    for (const index of table.indexes) {
      const cols = index.columns
        .filter((c) => c.column)
        .map((c) => q(columnName(c.column!)) + (c.desc === 'true' ? ' DESC' : ''));
      if (cols.length === 0 || !index.name) {
        continue;
      }
      const unique = index.nonUnique === 'true' ? '' : 'UNIQUE ';
      parts.push(`CREATE ${unique}INDEX ${q(index.name)} ON ${q(table.physicalName)} (${cols.join(', ')});`);
    }
  }

  // views
  for (const node of diagram.contents) {
    if (node.kind === 'view' && node.physicalName && node.sql) {
      parts.push(`CREATE VIEW ${q(node.physicalName)} AS\n${node.sql.trim()};`);
    }
  }

  // triggers (raw SQL as stored)
  for (const trg of diagram.triggers) {
    const sql = str(trg, 'sql');
    if (sql) {
      parts.push(sql.trim().replace(/;?$/, ';'));
    }
  }

  return parts.join('\n\n') + '\n';
}

function createTable(table: ErmTable, dialect: Dialect): string {
  const r = RULES[dialect];
  const q = r.quote;
  const lines: string[] = [];
  const columns = expandedColumns(table);

  for (const col of columns) {
    const autoInc = col.autoIncrement === 'true';
    const rawType = formatType(col) || 'text';
    let line = `  ${q(columnName(col))} ${r.mapType(rawType, autoInc)}`;
    if (col.notNull === 'true' && col.primaryKey !== 'true') {
      line += ' NOT NULL';
    }
    if (col.uniqueKey === 'true' && col.primaryKey !== 'true') {
      line += ' UNIQUE';
    }
    if (col.defaultValue) {
      line += ` DEFAULT ${col.defaultValue}`;
    }
    const isAuto =
      autoInc ||
      (col.referencedColumns.length === 0 && (col.word?.type === 'serial' || col.word?.type === 'bigserial'));
    if (isAuto && r.inlineAutoIncrement) {
      line += r.inlineAutoIncrement;
      // MySQL requires an AUTO_INCREMENT column to be a key
      if (dialect === 'MySQL' && col.primaryKey !== 'true') {
        line += ' UNIQUE';
      }
    }
    if (r.inlineComment) {
      const comment = col.description || col.word?.description;
      if (comment) {
        line += ` COMMENT ${sqlString(comment)}`;
      }
    }
    lines.push(line);
  }

  const pk = columns.filter((c) => c.primaryKey === 'true');
  if (pk.length > 0) {
    const name = table.primaryKeyName ? `CONSTRAINT ${q(table.primaryKeyName)} ` : '';
    lines.push(`  ${name}PRIMARY KEY (${pk.map((c) => q(columnName(c))).join(', ')})`);
  }

  for (const cuk of table.complexUniqueKeys) {
    const cols = cuk.columns.filter((c): c is NonNullable<typeof c> => !!c);
    if (cols.length > 0) {
      const name = cuk.name ? `CONSTRAINT ${q(cuk.name)} ` : '';
      lines.push(`  ${name}UNIQUE (${cols.map((c) => q(columnName(c))).join(', ')})`);
    }
  }

  let stmt = `CREATE TABLE ${q(table.physicalName)} (\n${lines.join(',\n')}\n)`;
  if (RULES[dialect].inlineComment) {
    const comment = table.description || table.logicalName;
    if (comment && comment !== table.physicalName) {
      stmt += ` COMMENT = ${sqlString(comment)}`;
    }
  }
  return stmt + ';';
}
