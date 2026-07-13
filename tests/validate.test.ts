import { describe, expect, it } from 'vitest';
import { validateDiagram } from '../src/erm/validate';
import { addColumn, addTable, emptyDiagram, setColumnName } from '../src/erm/ops';
import { expandedColumns } from '../src/erm/model';

describe('validateDiagram', () => {
  it('accepts a clean diagram', () => {
    const d = emptyDiagram();
    const t = addTable(d, 0, 0);
    t.physicalName = 'users';
    addColumn(t, 'email', 'varchar(255)');
    expect(validateDiagram(d)).toHaveLength(0);
  });

  it('reports duplicate table names', () => {
    const d = emptyDiagram();
    addTable(d, 0, 0).physicalName = 'users';
    addTable(d, 300, 0).physicalName = 'USERS';
    const issues = validateDiagram(d);
    expect(issues.filter((i) => i.severity === 'error')).toHaveLength(2);
    expect(issues[0].message).toContain('users');
  });

  it('reports empty table name', () => {
    const d = emptyDiagram();
    addTable(d, 0, 0).physicalName = '';
    const issues = validateDiagram(d);
    expect(issues.some((i) => i.severity === 'error' && i.message.includes('has no physical name'))).toBe(true);
  });

  it('reports duplicate columns once', () => {
    const d = emptyDiagram();
    const t = addTable(d, 0, 0);
    t.physicalName = 'users';
    addColumn(t, 'email', 'text');
    addColumn(t, 'EMAIL', 'text');
    const issues = validateDiagram(d).filter((i) => i.message.includes('Duplicate column'));
    expect(issues).toHaveLength(1);
  });

  it('warns on missing PK and empty type', () => {
    const d = emptyDiagram();
    const t = addTable(d, 0, 0);
    t.physicalName = 'logs';
    const pk = expandedColumns(t)[0];
    pk.primaryKey = 'false';
    const c = addColumn(t, 'note', 'text');
    c.word!.type = '';
    const issues = validateDiagram(d);
    expect(issues.some((i) => i.message.includes('has no primary key'))).toBe(true);
    expect(issues.some((i) => i.message.includes('has no type'))).toBe(true);
  });

  it('provides text anchors for locating issues', () => {
    const d = emptyDiagram();
    addTable(d, 0, 0).physicalName = 'users';
    addTable(d, 300, 0).physicalName = 'users';
    const issues = validateDiagram(d);
    expect(issues[0].anchor).toBe('<physical_name>users</physical_name>');
  });
});
