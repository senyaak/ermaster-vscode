import { describe, expect, it } from 'vitest';
import { importDdl } from '../src/erm/importDdl';
import { ErmTable, expandedColumns, isTable } from '../src/erm/model';
import { columnName, formatType } from '../src/erm/ops';
import { loadErm } from '../src/erm/load';
import { writeErm } from '../src/erm/write';
import { generateDdl } from '../src/ddl';

const SQL = `
-- shop schema
CREATE TABLE "users" (
  "id" serial,
  "email" varchar(255) NOT NULL UNIQUE,
  "name" varchar(100) DEFAULT 'anon',
  PRIMARY KEY ("id")
);

CREATE TABLE orders (
  id serial PRIMARY KEY,
  user_id integer NOT NULL,
  total numeric(10,2),
  created_at timestamp DEFAULT now()
);

CREATE TABLE order_items (
  id serial,
  order_id integer,
  sku varchar(64),
  CONSTRAINT pk_items PRIMARY KEY (id),
  CONSTRAINT uq_order_sku UNIQUE (order_id, sku),
  FOREIGN KEY (order_id) REFERENCES orders (id) ON DELETE CASCADE
);

ALTER TABLE orders ADD CONSTRAINT fk_orders_user FOREIGN KEY (user_id) REFERENCES "users" (id) ON DELETE SET NULL;
`;

describe('importDdl', () => {
  const d = importDdl(SQL);
  const table = (name: string) =>
    d.contents.find((n) => isTable(n) && n.physicalName === name) as ErmTable;

  it('creates tables with columns and flags', () => {
    expect(d.contents.filter(isTable)).toHaveLength(3);
    const users = table('users');
    const cols = expandedColumns(users);
    expect(cols.map(columnName)).toEqual(['id', 'email', 'name']);
    expect(cols[0].primaryKey).toBe('true');
    expect(formatType(cols[0])).toBe('serial');
    expect(cols[1].notNull).toBe('true');
    expect(cols[1].uniqueKey).toBe('true');
    expect(formatType(cols[1])).toBe('varchar(255)');
    expect(cols[2].defaultValue).toBe("'anon'");
  });

  it('parses inline PRIMARY KEY and numeric types', () => {
    const orders = table('orders');
    const cols = expandedColumns(orders);
    expect(cols[0].primaryKey).toBe('true');
    expect(formatType(cols[2])).toBe('numeric(10,2)');
    expect(cols[3].defaultValue).toBe('now()');
  });

  it('creates FK relations from table-level and ALTER TABLE constraints', () => {
    const orders = table('orders');
    const items = table('order_items');
    expect(orders.base.incomings).toHaveLength(1);
    expect(items.base.incomings).toHaveLength(1);
    const rel = orders.base.incomings[0];
    expect(rel.kind === 'relation' && rel.onDeleteAction).toBe('SET NULL');
    expect(rel.kind === 'relation' && rel.name).toBe('fk_orders_user');
  });

  it('parses composite unique constraints', () => {
    const items = table('order_items');
    expect(items.complexUniqueKeys).toHaveLength(1);
    expect(items.complexUniqueKeys[0].name).toBe('uq_order_sku');
    expect(items.complexUniqueKeys[0].columns).toHaveLength(2);
    expect(items.primaryKeyName).toBe('pk_items');
  });

  it('result round-trips as valid .erm', () => {
    const xml = writeErm(d);
    expect(writeErm(loadErm(xml))).toBe(xml);
  });

  it('imported model produces DDL again', () => {
    const ddl = generateDdl(d, 'PostgreSQL');
    expect(ddl).toContain('CREATE TABLE "users"');
    expect(ddl).toContain('ON DELETE SET NULL');
    expect(ddl).toContain('CONSTRAINT "uq_order_sku" UNIQUE');
  });
});
