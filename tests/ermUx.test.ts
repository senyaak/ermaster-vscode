import { describe, expect, it } from 'vitest';
import { expandedColumns, isTable, ErmTable } from '../src/erm/model';
import { loadErm } from '../src/erm/load';
import { writeErm } from '../src/erm/write';
import {
  addColumn,
  addTable,
  columnDisplayName,
  columnName,
  createRelationAutoFk,
  emptyDiagram,
  formatType,
  moveColumnItem,
  removeRelation,
  setViewMode,
  tableDisplayName,
  viewModeOf,
} from '../src/erm/ops';

describe('createRelationAutoFk (palette relation tool)', () => {
  it('copies parent PK into the child as FK columns sharing the word', () => {
    const d = emptyDiagram();
    const parent = addTable(d, 0, 0);
    parent.physicalName = 'users';
    const child = addTable(d, 300, 0);
    child.physicalName = 'orders';
    const before = expandedColumns(child).length;

    const rel = createRelationAutoFk(parent, child)!;
    expect(rel).not.toBeNull();
    expect(rel.referenceForPk).toBe('true');
    expect(rel.source).toBe(parent);
    expect(rel.target).toBe(child);

    const cols = expandedColumns(child);
    expect(cols).toHaveLength(before + 1);
    const fk = cols[cols.length - 1];
    expect(fk.word).toBe(expandedColumns(parent)[0].word);
    expect(columnName(fk)).toBe('id'); // inherited from parent PK
    expect(formatType(fk)).toBe('integer'); // serial → integer for FK
    expect(fk.notNull).toBe('true');
    expect(fk.relations).toContain(rel);
  });

  it('copies composite PK as several FK columns on one relation', () => {
    const d = emptyDiagram();
    const parent = addTable(d, 0, 0);
    const extra = addColumn(parent, 'tenant_id', 'integer');
    extra.primaryKey = 'true';
    const child = addTable(d, 300, 0);
    const before = expandedColumns(child).length;
    const rel = createRelationAutoFk(parent, child)!;
    const fks = expandedColumns(child).filter((c) => c.relations.includes(rel));
    expect(fks).toHaveLength(2);
    expect(expandedColumns(child)).toHaveLength(before + 2);
  });

  it('returns null when the parent has no PK', () => {
    const d = emptyDiagram();
    const parent = addTable(d, 0, 0);
    expandedColumns(parent)[0].primaryKey = 'false';
    const child = addTable(d, 300, 0);
    expect(createRelationAutoFk(parent, child)).toBeNull();
    expect(child.base.incomings).toHaveLength(0);
  });

  it('round-trips and removes cleanly', () => {
    const d = emptyDiagram();
    const parent = addTable(d, 0, 0);
    parent.physicalName = 'p';
    const child = addTable(d, 300, 0);
    child.physicalName = 'c';
    createRelationAutoFk(parent, child);
    const xml = writeErm(d);
    expect(writeErm(loadErm(xml))).toBe(xml);

    const loaded = loadErm(xml);
    const lChild = loaded.contents.find((n) => isTable(n) && n.physicalName === 'c') as ErmTable;
    const rel = lChild.base.incomings[0];
    expect(rel.kind).toBe('relation');
    if (rel.kind === 'relation') {
      removeRelation(loaded, rel);
    }
    // auto-created FK column stays as a plain column (ERMaster behavior)
    const released = expandedColumns(lChild).find((c) => c.word?.physicalName === 'id' && c.primaryKey === 'false');
    expect(released).toBeDefined();
  });
});

describe('column ordering', () => {
  it('moves own columns up and down', () => {
    const d = emptyDiagram();
    const t = addTable(d, 0, 0);
    addColumn(t, 'a', 'text');
    addColumn(t, 'b', 'text');
    const names = () => expandedColumns(t).map((c) => columnName(c));
    expect(names()).toEqual(['id', 'a', 'b']);
    moveColumnItem(t, 2, -1);
    expect(names()).toEqual(['id', 'b', 'a']);
    moveColumnItem(t, 0, 1);
    expect(names()).toEqual(['b', 'id', 'a']);
    moveColumnItem(t, 0, -1); // no-op at boundary
    expect(names()).toEqual(['b', 'id', 'a']);
  });
});

describe('view modes', () => {
  it('maps to ERMaster settings values and back', () => {
    const d = emptyDiagram();
    expect(viewModeOf(d)).toBe('physical');
    setViewMode(d, 'logical');
    expect(d.settings.viewMode).toBe('0');
    expect(viewModeOf(d)).toBe('logical');
    setViewMode(d, 'both');
    expect(d.settings.viewMode).toBe('2');
  });

  it('formats table and column captions per mode', () => {
    const d = emptyDiagram();
    const t = addTable(d, 0, 0);
    t.physicalName = 'users';
    t.logicalName = 'Benutzer';
    expect(tableDisplayName(t, 'physical')).toBe('users');
    expect(tableDisplayName(t, 'logical')).toBe('Benutzer');
    expect(tableDisplayName(t, 'both')).toBe('Benutzer / users');

    const c = addColumn(t, 'email', 'text');
    c.word!.logicalName = 'E-Mail';
    expect(columnDisplayName(c, 'physical')).toBe('email');
    expect(columnDisplayName(c, 'logical')).toBe('E-Mail');
    expect(columnDisplayName(c, 'both')).toBe('E-Mail / email');
  });
});
