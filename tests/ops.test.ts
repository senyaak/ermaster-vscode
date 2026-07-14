import { describe, expect, it } from 'vitest';
import { ErmView, expandedColumns, isTable } from '../src/erm/model';
import { loadErm } from '../src/erm/load';
import { writeErm } from '../src/erm/write';
import {
  addBendpoint,
  addColumn,
  addColumnGroup,
  addColumnToGroup,
  addComplexUniqueKey,
  addIndex,
  addNote,
  addTable,
  addViewColumn,
  allRelations,
  columnName,
  createRelation,
  createRelationAutoFk,
  deleteColumn,
  deleteColumnGroup,
  deleteViewColumn,
  moveBendpoint,
  removeBendpoint,
  tableHasGroup,
  toggleTableGroup,
  deleteComplexUniqueKey,
  deleteNode,
  emptyDiagram,
  formatType,
  hexToRgb,
  parseTypeInput,
  removeRelation,
  rgbToHex,
  setColumnName,
  setColumnType,
  toggleCukColumn,
  toggleIndexColumn,
} from '../src/erm/ops';

describe('type helpers', () => {
  it('parses parameterized types to ERMaster type ids', () => {
    expect(parseTypeInput('varchar(255)')).toEqual({ typeId: 'varchar(n)', length: '255', decimal: 'null' });
    expect(parseTypeInput('numeric(10,2)')).toEqual({ typeId: 'numeric(p,s)', length: '10', decimal: '2' });
    expect(parseTypeInput('integer')).toEqual({ typeId: 'integer', length: 'null', decimal: 'null' });
    expect(parseTypeInput('char(3)')).toEqual({ typeId: 'char(n)', length: '3', decimal: 'null' });
  });

  it('formats types back with lengths', () => {
    const t = addTable(emptyDiagram(), 0, 0);
    const c = addColumn(t, 'x', 'varchar(255)');
    expect(formatType(c)).toBe('varchar(255)');
    setColumnType(c, 'numeric(12,4)');
    expect(formatType(c)).toBe('numeric(12,4)');
    setColumnType(c, 'text');
    expect(formatType(c)).toBe('text');
  });

  it('FK columns inherit type with serial→integer', () => {
    const d = emptyDiagram();
    const parent = addTable(d, 0, 0);
    const child = addTable(d, 300, 0);
    const fk = addColumn(child, 'parent_id', 'integer');
    createRelation(d, child, fk, parent, expandedColumns(parent)[0]);
    expect(formatType(fk)).toBe('integer'); // parent id is serial
  });
});

describe('column names', () => {
  it('plain column names live in the word', () => {
    const t = addTable(emptyDiagram(), 0, 0);
    const c = addColumn(t, 'email', 'text');
    expect(c.physicalName).toBe('');
    expect(c.word!.physicalName).toBe('email');
    expect(columnName(c)).toBe('email');
    setColumnName(c, 'email2');
    expect(c.word!.physicalName).toBe('email2');
    expect(c.physicalName).toBe('');
  });

  it('FK column names are overrides on the column', () => {
    const d = emptyDiagram();
    const parent = addTable(d, 0, 0);
    const child = addTable(d, 300, 0);
    const fk = addColumn(child, 'user_id', 'integer');
    createRelation(d, child, fk, parent, expandedColumns(parent)[0]);
    expect(fk.word).toBeNull();
    expect(columnName(fk)).toBe('user_id');
    setColumnName(fk, 'owner_id');
    expect(fk.physicalName).toBe('owner_id');
    expect(columnName(fk)).toBe('owner_id');
  });
});

describe('relations', () => {
  it('createRelation wires both sides and reference_for_pk', () => {
    const d = emptyDiagram();
    const parent = addTable(d, 0, 0);
    const child = addTable(d, 300, 0);
    const fk = addColumn(child, 'p_id', 'integer');
    const rel = createRelation(d, child, fk, parent, expandedColumns(parent)[0]);
    expect(rel.referenceForPk).toBe('true'); // single-column PK
    expect(rel.referencedColumn).toBeNull();
    expect(child.base.incomings).toContain(rel);
    expect(fk.relations).toContain(rel);
    expect(fk.referencedColumns).toContain(expandedColumns(parent)[0]);
  });

  it('relation to a unique non-PK column uses referenced_column', () => {
    const d = emptyDiagram();
    const parent = addTable(d, 0, 0);
    const uniqueCol = addColumn(parent, 'code', 'varchar(10)');
    uniqueCol.uniqueKey = 'true';
    const child = addTable(d, 300, 0);
    const fk = addColumn(child, 'code_ref', 'varchar(10)');
    const rel = createRelation(d, child, fk, parent, uniqueCol);
    expect(rel.referenceForPk).toBe('false');
    expect(rel.referencedColumn).toBe(uniqueCol);
  });

  it('removeRelation releases the FK column', () => {
    const d = emptyDiagram();
    const parent = addTable(d, 0, 0);
    const child = addTable(d, 300, 0);
    const fk = addColumn(child, 'p_id', 'integer');
    const rel = createRelation(d, child, fk, parent, expandedColumns(parent)[0]);
    removeRelation(d, rel);
    expect(child.base.incomings).toHaveLength(0);
    expect(fk.relations).toHaveLength(0);
    expect(fk.referencedColumns).toHaveLength(0);
    expect(fk.word).not.toBeNull();
    expect(columnName(fk)).toBe('p_id');
  });

  it('deleting a referenced column drops the relation', () => {
    const d = emptyDiagram();
    const parent = addTable(d, 0, 0);
    const child = addTable(d, 300, 0);
    const fk = addColumn(child, 'p_id', 'integer');
    createRelation(d, child, fk, parent, expandedColumns(parent)[0]);
    deleteColumn(d, parent, expandedColumns(parent)[0]);
    expect(child.base.incomings).toHaveLength(0);
    expect(fk.referencedColumns).toHaveLength(0);
  });
});

describe('bendpoints', () => {
  function withRelation() {
    const d = emptyDiagram();
    const parent = addTable(d, 0, 0);
    parent.physicalName = 'parent';
    addColumn(parent, 'id', 'serial');
    expandedColumns(parent)[0].primaryKey = 'true';
    const child = addTable(d, 400, 0);
    child.physicalName = 'child';
    const rel = createRelationAutoFk(parent, child)!;
    return { d, rel };
  }

  it('allRelations lists relations in render order', () => {
    const { d, rel } = withRelation();
    expect(allRelations(d)).toEqual([rel]);
  });

  it('add / move / remove bendpoints', () => {
    const { rel } = withRelation();
    addBendpoint(rel, 0, 100.4, 50.6);
    expect(rel.bendpoints).toEqual([{ relative: 'false', x: '100', y: '51' }]);
    addBendpoint(rel, 1, 200, 80);
    expect(rel.bendpoints.map((b) => b.x)).toEqual(['100', '200']);
    moveBendpoint(rel, 0, 120, 60);
    expect(rel.bendpoints[0]).toEqual({ relative: 'false', x: '120', y: '60' });
    removeBendpoint(rel, 0);
    expect(rel.bendpoints).toEqual([{ relative: 'false', x: '200', y: '80' }]);
  });

  it('addBendpoint clamps the insertion index', () => {
    const { rel } = withRelation();
    addBendpoint(rel, 99, 10, 10);
    addBendpoint(rel, -5, 20, 20);
    expect(rel.bendpoints.map((b) => b.x)).toEqual(['20', '10']);
  });

  it('bendpoints survive a round-trip', () => {
    const { d, rel } = withRelation();
    addBendpoint(rel, 0, 150, 75);
    const reloaded = loadErm(writeErm(d));
    expect(allRelations(reloaded)[0].bendpoints).toEqual([
      { relative: 'false', x: '150', y: '75' },
    ]);
  });
});

describe('column groups', () => {
  // addTable seeds a default "id" PK column; clear it so tests focus on groups
  function emptyTable(d: ReturnType<typeof emptyDiagram>, x = 0, y = 0) {
    const t = addTable(d, x, y);
    t.columns = [];
    return t;
  }

  it('attach expands the group columns into the table', () => {
    const d = emptyDiagram();
    const t = emptyTable(d);
    const group = addColumnGroup(d, 'audit');
    addColumnToGroup(group, 'created_at', 'timestamp');
    addColumnToGroup(group, 'updated_at', 'timestamp');
    expect(tableHasGroup(t, group)).toBe(false);
    toggleTableGroup(t, group);
    expect(tableHasGroup(t, group)).toBe(true);
    expect(expandedColumns(t).map(columnName)).toEqual(['created_at', 'updated_at']);
    toggleTableGroup(t, group);
    expect(expandedColumns(t)).toHaveLength(0);
  });

  it('a group is shared across tables', () => {
    const d = emptyDiagram();
    const a = emptyTable(d, 0, 0);
    const b = emptyTable(d, 300, 0);
    const group = addColumnGroup(d, 'audit');
    addColumnToGroup(group, 'created_at', 'timestamp');
    toggleTableGroup(a, group);
    toggleTableGroup(b, group);
    // editing the shared column shows in both tables
    group.columns[0].word!.physicalName = 'created';
    expect(expandedColumns(a).map(columnName)).toEqual(['created']);
    expect(expandedColumns(b).map(columnName)).toEqual(['created']);
  });

  it('deleteColumnGroup detaches it everywhere', () => {
    const d = emptyDiagram();
    const t = emptyTable(d);
    const group = addColumnGroup(d, 'audit');
    addColumnToGroup(group, 'created_at', 'timestamp');
    toggleTableGroup(t, group);
    deleteColumnGroup(d, group);
    expect(d.columnGroups).toHaveLength(0);
    expect(tableHasGroup(t, group)).toBe(false);
    expect(expandedColumns(t)).toHaveLength(0);
  });

  it('column groups survive a round-trip', () => {
    const d = emptyDiagram();
    const t = emptyTable(d);
    t.physicalName = 'orders';
    const group = addColumnGroup(d, 'audit');
    addColumnToGroup(group, 'created_at', 'timestamp');
    toggleTableGroup(t, group);
    const reloaded = loadErm(writeErm(d));
    expect(reloaded.columnGroups.map((g) => g.groupName)).toEqual(['audit']);
    const rt = reloaded.contents.find(isTable)!;
    expect(expandedColumns(rt).map(columnName)).toEqual(['created_at']);
  });
});

describe('view columns', () => {
  function makeView(): ErmView {
    return {
      kind: 'view',
      base: { height: '-1', width: '-1', fontName: '', fontSize: '9', x: '0', y: '0', color: null, incomings: [] },
      physicalName: 'v_users',
      logicalName: '',
      description: '',
      sql: 'SELECT id, email FROM users',
      columns: [],
      viewProperties: null,
    };
  }

  it('add / delete view columns', () => {
    const v = makeView();
    const a = addViewColumn(v, 'id', 'integer');
    addViewColumn(v, 'email', 'varchar(255)');
    expect(expandedColumns(v).map(columnName)).toEqual(['id', 'email']);
    deleteViewColumn(v, a);
    expect(expandedColumns(v).map(columnName)).toEqual(['email']);
  });

  it('view columns survive a round-trip', () => {
    const d = emptyDiagram();
    const v = makeView();
    addViewColumn(v, 'id', 'integer');
    d.contents.push(v);
    const reloaded = loadErm(writeErm(d));
    const rv = reloaded.contents.find((n): n is ErmView => n.kind === 'view')!;
    expect(expandedColumns(rv).map(columnName)).toEqual(['id']);
  });
});

describe('indexes and unique keys', () => {
  it('index add/toggle survives round-trip', () => {
    const d = emptyDiagram();
    const t = addTable(d, 0, 0);
    const email = addColumn(t, 'email', 'varchar(255)');
    const idx = addIndex(t);
    idx.name = 'idx_users_email';
    idx.nonUnique = 'false';
    toggleIndexColumn(idx, email);
    const reloaded = loadErm(writeErm(d));
    const rt = reloaded.contents.find(isTable)!;
    expect(rt.indexes).toHaveLength(1);
    expect(rt.indexes[0].name).toBe('idx_users_email');
    expect(rt.indexes[0].nonUnique).toBe('false');
    expect(rt.indexes[0].columns).toHaveLength(1);
    expect(columnName(rt.indexes[0].columns[0].column!)).toBe('email');
    // toggle off
    toggleIndexColumn(idx, email);
    expect(idx.columns).toHaveLength(0);
  });

  it('deleting a column removes it from indexes', () => {
    const d = emptyDiagram();
    const t = addTable(d, 0, 0);
    const email = addColumn(t, 'email', 'varchar(255)');
    const idx = addIndex(t);
    toggleIndexColumn(idx, email);
    deleteColumn(d, t, email);
    expect(t.indexes).toHaveLength(0); // empty index dropped
  });

  it('complex unique keys round-trip and can back relations', () => {
    const d = emptyDiagram();
    const t = addTable(d, 0, 0);
    const a = addColumn(t, 'a', 'integer');
    const b = addColumn(t, 'b', 'integer');
    const cuk = addComplexUniqueKey(t);
    cuk.name = 'uq_ab';
    toggleCukColumn(cuk, a);
    toggleCukColumn(cuk, b);
    const reloaded = loadErm(writeErm(d));
    const rt = reloaded.contents.find(isTable)!;
    expect(rt.complexUniqueKeys).toHaveLength(1);
    expect(rt.complexUniqueKeys[0].columns).toHaveLength(2);
    deleteComplexUniqueKey(d, t, cuk);
    expect(t.complexUniqueKeys).toHaveLength(0);
  });
});

describe('notes', () => {
  it('notes round-trip with text', () => {
    const d = emptyDiagram();
    addNote(d, 100, 100, 'Hello,\nwörld <tag> & "quotes"');
    const reloaded = loadErm(writeErm(d));
    const note = reloaded.contents.find((n) => n.kind === 'note')!;
    expect(note.kind === 'note' && note.text).toBe('Hello,\nwörld <tag> & "quotes"');
  });

  it('deleteNode removes a note', () => {
    const d = emptyDiagram();
    const note = addNote(d, 0, 0, 'x');
    deleteNode(d, note);
    expect(d.contents).toHaveLength(0);
  });
});

describe('colors', () => {
  it('rgb/hex conversions', () => {
    expect(rgbToHex({ r: '128', g: '128', b: '192' })).toBe('#8080c0');
    expect(hexToRgb('#8080C0')).toEqual({ r: '128', g: '128', b: '192' });
    expect(hexToRgb('garbage')).toEqual({ r: '255', g: '255', b: '255' });
  });
});
