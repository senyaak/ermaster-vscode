import { describe, expect, it } from 'vitest';
import { ErmColumn, ErmTestData, expandedColumns } from '../src/erm/model';
import { addColumn, addTable, emptyDiagram } from '../src/erm/ops';
import { generateTestData } from '../src/erm/testData';

function directRow(pairs: [ErmColumn, string][]) {
  return pairs.map(([column, value]) => ({ column, value }));
}

describe('test data → SQL', () => {
  it('emits direct rows as INSERT statements', () => {
    const d = emptyDiagram();
    const t = addTable(d, 0, 0);
    t.physicalName = 'users';
    t.logicalName = 'Users';
    const id = expandedColumns(t)[0]; // seeded id
    const email = addColumn(t, 'email', 'varchar(255)');

    const set: ErmTestData = {
      name: 'set1',
      exportOrder: '0',
      tables: [
        {
          table: t,
          directRows: [
            directRow([
              [id, '1'],
              [email, 'a@x.com'],
            ]),
            directRow([
              [id, '2'],
              [email, 'null'],
            ]),
          ],
          repeatTestDataNum: '0',
          repeatDefs: [],
        },
      ],
    };
    d.testDataList.push(set);

    const sql = generateTestData(d);
    expect(sql).toContain('-- Users');
    expect(sql).toContain("INSERT INTO users (id, email) VALUES ('1', 'a@x.com');");
    // 'null' (any case) is emitted unquoted
    expect(sql).toContain("INSERT INTO users (id, email) VALUES ('2', null);");
  });

  it('generates repeat rows with format and enum defs', () => {
    const d = emptyDiagram();
    const t = addTable(d, 0, 0);
    t.physicalName = 'items';
    const id = expandedColumns(t)[0];
    const code = addColumn(t, 'code', 'varchar(10)');
    const status = addColumn(t, 'status', 'varchar(10)');

    const set: ErmTestData = {
      name: 's',
      exportOrder: '0',
      tables: [
        {
          table: t,
          directRows: [],
          repeatTestDataNum: '3',
          repeatDefs: [
            { column: id, type: 'format', repeatNum: '1', template: '%', from: '1', to: '100', increment: '1', selects: [], modifiedValues: [] },
            { column: code, type: 'format', repeatNum: '1', template: 'C-%', from: '10', to: '99', increment: '5', selects: [], modifiedValues: [] },
            { column: status, type: 'enum', repeatNum: '1', template: '', from: '', to: '', increment: '', selects: ['new', 'done'], modifiedValues: [] },
          ],
        },
      ],
    };
    d.testDataList.push(set);

    const sql = generateTestData(d);
    const lines = sql.split('\n').filter((l) => l.startsWith('INSERT'));
    expect(lines).toHaveLength(3);
    // format: id 1,2,3 ; code C-10, C-15, C-20 ; enum cycles new/done/new
    expect(lines[0]).toBe("INSERT INTO items (id, code, status) VALUES ('1', 'C-10', 'new');");
    expect(lines[1]).toBe("INSERT INTO items (id, code, status) VALUES ('2', 'C-15', 'done');");
    expect(lines[2]).toBe("INSERT INTO items (id, code, status) VALUES ('3', 'C-20', 'new');");
  });

  it('applies modified-value overrides on specific rows', () => {
    const d = emptyDiagram();
    const t = addTable(d, 0, 0);
    t.physicalName = 't';
    const id = expandedColumns(t)[0];

    const set: ErmTestData = {
      name: 's',
      exportOrder: '0',
      tables: [
        {
          table: t,
          directRows: [],
          repeatTestDataNum: '2',
          repeatDefs: [
            {
              column: id,
              type: 'format',
              repeatNum: '1',
              template: '%',
              from: '1',
              to: '100',
              increment: '1',
              selects: [],
              modifiedValues: [{ row: '1', value: '999' }],
            },
          ],
        },
      ],
    };
    d.testDataList.push(set);

    const lines = generateTestData(d).split('\n').filter((l) => l.startsWith('INSERT'));
    expect(lines[0]).toBe("INSERT INTO t (id) VALUES ('1');");
    expect(lines[1]).toBe("INSERT INTO t (id) VALUES ('999');"); // row 1 overridden
  });

  it('returns empty string when there is no test data', () => {
    const d = emptyDiagram();
    addTable(d, 0, 0);
    expect(generateTestData(d)).toBe('');
  });
});
