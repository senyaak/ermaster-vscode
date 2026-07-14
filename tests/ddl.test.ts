import { describe, expect, it } from 'vitest';
import { generateDdl } from '../src/ddl';
import { addColumn, addComplexUniqueKey, addIndex, addTable, emptyDiagram, toggleCukColumn, toggleIndexColumn } from '../src/erm/ops';
import { buildShop } from './helpers';

describe('DDL PostgreSQL', () => {
  it('generates tables, PK, FK, comments', () => {
    const ddl = generateDdl(buildShop(), 'PostgreSQL');
    expect(ddl).toContain('CREATE TABLE "users"');
    expect(ddl).toContain('"id" serial');
    expect(ddl).toContain('"email" varchar(255) NOT NULL UNIQUE');
    expect(ddl).toContain('PRIMARY KEY ("id")');
    expect(ddl).toContain('FOREIGN KEY ("user_id") REFERENCES "users" ("id") ON DELETE CASCADE');
    expect(ddl).toContain('COMMENT ON TABLE "users" IS \'Users\';');
    expect(ddl).toContain('DEFAULT now()');
  });

  it('emits indexes and composite unique constraints', () => {
    const d = emptyDiagram();
    const t = addTable(d, 0, 0);
    t.physicalName = 'users';
    const email = addColumn(t, 'email', 'varchar(255)');
    const name = addColumn(t, 'name', 'varchar(100)');
    const idx = addIndex(t);
    idx.name = 'idx_users_email';
    idx.nonUnique = 'false';
    toggleIndexColumn(idx, email);
    const cuk = addComplexUniqueKey(t);
    cuk.name = 'uq_email_name';
    toggleCukColumn(cuk, email);
    toggleCukColumn(cuk, name);
    const ddl = generateDdl(d, 'PostgreSQL');
    expect(ddl).toContain('CREATE UNIQUE INDEX "idx_users_email" ON "users" ("email");');
    expect(ddl).toContain('CONSTRAINT "uq_email_name" UNIQUE ("email", "name")');
  });

  it('emits sequences and views', () => {
    const d = buildShop();
    d.contents.push({
      kind: 'view',
      base: { height: '-1', width: '-1', fontName: '', fontSize: '9', x: '0', y: '600', color: null, incomings: [] },
      physicalName: 'v_users',
      logicalName: '',
      description: '',
      sql: 'SELECT id, email FROM users',
      columns: [],
      viewProperties: null,
    });
    const ddl = generateDdl(d, 'PostgreSQL');
    expect(ddl).toContain('CREATE VIEW "v_users" AS\nSELECT id, email FROM users;');
  });
});

describe('DDL MySQL', () => {
  it('uses backticks, AUTO_INCREMENT and inline comments', () => {
    const d = buildShop();
    const ddl = generateDdl(d, 'MySQL');
    expect(ddl).toContain('CREATE TABLE `users`');
    expect(ddl).toContain('`id` int AUTO_INCREMENT'); // serial → int AUTO_INCREMENT
    expect(ddl).toContain('PRIMARY KEY (`id`)');
    expect(ddl).toContain("COMMENT = 'Users'");
    expect(ddl).not.toContain('COMMENT ON TABLE');
    expect(ddl).toContain('FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE');
  });

  it('maps PostgreSQL-only types', () => {
    const d = emptyDiagram();
    const t = addTable(d, 0, 0);
    t.physicalName = 't';
    addColumn(t, 'data', 'bytea');
    addColumn(t, 'flag', 'boolean');
    addColumn(t, 'ts', 'timestamptz');
    const ddl = generateDdl(d, 'MySQL');
    expect(ddl).toContain('`data` blob');
    expect(ddl).toContain('`flag` tinyint(1)');
    expect(ddl).toContain('`ts` timestamp');
  });
});

describe('DDL Oracle', () => {
  it('maps types to NUMBER/VARCHAR2 and uses sequences, not IDENTITY', () => {
    const ddl = generateDdl(buildShop(), 'Oracle');
    expect(ddl).toContain('CREATE TABLE "users"');
    expect(ddl).toContain('"id" NUMBER(10)'); // serial → NUMBER(10)
    expect(ddl).toContain('"email" VARCHAR2(255) NOT NULL UNIQUE');
    expect(ddl).toContain('PRIMARY KEY ("id")');
    expect(ddl).toContain('COMMENT ON TABLE "users" IS \'Users\';');
    expect(ddl).not.toContain('IDENTITY');
    expect(ddl).not.toContain('AUTO_INCREMENT');
  });
});

describe('DDL SQLServer', () => {
  it('uses bracket quoting and IDENTITY, no COMMENT ON', () => {
    const d = buildShop();
    addColumn(d.contents.find((n) => n.kind === 'table' && n.physicalName === 'users')! as never, 'active', 'boolean');
    const ddl = generateDdl(d, 'SQLServer');
    expect(ddl).toContain('CREATE TABLE [users]');
    expect(ddl).toContain('[id] INT IDENTITY(1,1)');
    expect(ddl).toContain('[active] BIT');
    expect(ddl).toContain('PRIMARY KEY ([id])');
    expect(ddl).toContain('FOREIGN KEY ([user_id]) REFERENCES [users] ([id])');
    expect(ddl).not.toContain('COMMENT ON');
  });
});

describe('DDL SQLite', () => {
  it('maps serial to INTEGER, no sequences or comments', () => {
    const ddl = generateDdl(buildShop(), 'SQLite');
    expect(ddl).toContain('CREATE TABLE "users"');
    expect(ddl).toContain('"id" INTEGER');
    expect(ddl).toContain('PRIMARY KEY ("id")');
    expect(ddl).not.toContain('CREATE SEQUENCE');
    expect(ddl).not.toContain('COMMENT ON');
    expect(ddl).not.toContain('IDENTITY');
  });
});

describe('dialect from settings', () => {
  it('uses the diagram database setting', () => {
    const d = buildShop();
    d.settings.database = 'MySQL';
    expect(generateDdl(d)).toContain('CREATE TABLE `users`');
    d.settings.database = 'PostgreSQL';
    expect(generateDdl(d)).toContain('CREATE TABLE "users"');
    d.settings.database = 'Oracle';
    expect(generateDdl(d)).toContain('VARCHAR2');
    d.settings.database = 'SQLServer';
    expect(generateDdl(d)).toContain('CREATE TABLE [users]');
    d.settings.database = 'SQLite';
    expect(generateDdl(d)).toContain('"id" INTEGER');
  });
});
