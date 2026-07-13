import { describe, expect, it } from 'vitest';
import { addColumn, addTable, columnName, createRelationAutoFk, emptyDiagram } from '../src/erm/ops';
import { orderedColumns, pkCount, boxWidth, boxHeight, HEADER_H, ROW_H } from '../src/webview/geometry';
import { expandedColumns } from '../src/erm/model';

describe('geometry', () => {
  it('orders primary keys first', () => {
    const d = emptyDiagram();
    const t = addTable(d, 0, 0); // has PK "id"
    addColumn(t, 'email', 'text');
    const pk = addColumn(t, 'code', 'text');
    pk.primaryKey = 'true';
    const ordered = orderedColumns(t).map(columnName);
    expect(ordered.slice(0, 2).sort()).toEqual(['code', 'id']); // both PKs first
    expect(ordered[2]).toBe('email');
    expect(pkCount(t)).toBe(2);
  });

  it('height scales with column count', () => {
    const d = emptyDiagram();
    const t = addTable(d, 0, 0);
    expect(boxHeight(t)).toBe(HEADER_H + ROW_H);
    addColumn(t, 'a', 'text');
    expect(boxHeight(t)).toBe(HEADER_H + 2 * ROW_H);
  });

  it('width grows with the longest column caption', () => {
    const d = emptyDiagram();
    const t = addTable(d, 0, 0);
    const narrow = boxWidth(t, 'physical');
    addColumn(t, 'a_very_long_column_name_here', 'varchar(255)');
    expect(boxWidth(t, 'physical')).toBeGreaterThan(narrow);
  });

  it('FK columns from auto relation appear in ordering', () => {
    const d = emptyDiagram();
    const parent = addTable(d, 0, 0);
    parent.physicalName = 'p';
    const child = addTable(d, 300, 0);
    createRelationAutoFk(parent, child);
    // child now has id (PK) + inherited FK "id" — both present
    expect(expandedColumns(child).length).toBe(2);
    expect(orderedColumns(child)[0].primaryKey).toBe('true');
  });
});
