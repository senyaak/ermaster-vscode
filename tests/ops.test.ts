import { describe, expect, it } from 'vitest';
import { expandedColumns, isTable } from '../src/erm/model';
import { loadErm } from '../src/erm/load';
import { writeErm } from '../src/erm/write';
import {
  addColumn,
  addComplexUniqueKey,
  addIndex,
  addNote,
  addTable,
  columnName,
  createRelation,
  deleteColumn,
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
