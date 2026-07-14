import { ErmColumn, ErmDiagram, ErmRepeatDataDef, ErmTableTestData, ErmTestData, expandedColumns } from './model';
import { columnName } from './ops';

/**
 * Generate SQL INSERT statements from a diagram's stored test data, mirroring
 * ERMaster's SQLTestDataCreator + TestDataCreator (repeat types: format,
 * foreign.key, enum, null; plus per-row modified-value overrides).
 */
export function generateTestData(diagram: ErmDiagram, testDataName?: string): string {
  const set =
    (testDataName ? diagram.testDataList.find((t) => t.name === testDataName) : diagram.testDataList[0]) ?? null;
  if (!set) {
    return '';
  }
  const gen = new TestDataGenerator(set);
  const blocks: string[] = [];
  for (const tableData of set.tables) {
    const table = tableData.table;
    if (!table) {
      continue;
    }
    const hasDirect = tableData.directRows.length > 0;
    const repeatNum = parseInt(tableData.repeatTestDataNum, 10) || 0;
    if (!hasDirect && repeatNum <= 0) {
      continue;
    }
    const lines: string[] = [`-- ${table.logicalName || table.physicalName}`];
    const emit = (values: (string | null)[]) => {
      const cols = expandedColumns(table).map((c) => columnName(c));
      const vals = values.map((v) => (v === null || v.toLowerCase() === 'null' ? 'null' : `'${v}'`));
      lines.push(`INSERT INTO ${table.physicalName} (${cols.join(', ')}) VALUES (${vals.join(', ')});`);
    };

    const directFirst = set.exportOrder !== '1'; // 0 (or unset) = direct → repeat
    const writeDirect = () => {
      for (const row of tableData.directRows) {
        emit(gen.directValues(table, row));
      }
    };
    const writeRepeat = () => {
      for (let i = 0; i < repeatNum; i++) {
        emit(expandedColumns(table).map((c) => gen.mergedRepeatValue(i, tableData, c)));
      }
    };
    if (directFirst) {
      writeDirect();
      writeRepeat();
    } else {
      writeRepeat();
      writeDirect();
    }
    blocks.push(lines.join('\n'));
  }
  return blocks.join('\n\n') + (blocks.length ? '\n' : '');
}

class TestDataGenerator {
  private valueListCache = new Map<ErmColumn, (string | null)[]>();

  constructor(private readonly set: ErmTestData) {}

  /** Values for a direct row, one per expanded column (null when unset). */
  directValues(
    table: NonNullable<ErmTableTestData['table']>,
    row: { column: ErmColumn | null; value: string }[],
  ): (string | null)[] {
    const map = new Map<ErmColumn, string>();
    for (const cell of row) {
      if (cell.column) {
        map.set(cell.column, cell.value);
      }
    }
    return expandedColumns(table).map((c) => (map.has(c) ? map.get(c)! : null));
  }

  /** A repeat row value with modified-value overrides applied. */
  mergedRepeatValue(count: number, tableData: ErmTableTestData, column: ErmColumn): string | null {
    const def = tableData.repeatDefs.find((d) => d.column === column) ?? null;
    if (def) {
      const modified = def.modifiedValues.find((m) => parseInt(m.row, 10) === count);
      if (modified) {
        return modified.value;
      }
    }
    return this.repeatValue(count, def, column);
  }

  private repeatValue(count: number, def: ErmRepeatDataDef | null, column: ErmColumn): string | null {
    if (!def) {
      return null;
    }
    const repeatNum = Math.max(1, parseInt(def.repeatNum, 10) || 1);

    if (def.type === 'format') {
      const decimals = Math.max(
        decimalPlaces(def.from),
        decimalPlaces(def.increment),
        decimalPlaces(def.to),
      );
      const scale = Math.pow(10, decimals);
      const from = Math.round(parseFloat(def.from || '0') * scale);
      const increment = Math.round(parseFloat(def.increment || '0') * scale);
      const to = Math.round(parseFloat(def.to || '0') * scale);
      const span = to - from + 1;
      let num = from;
      if (repeatNum !== 0 && span !== 0) {
        num = from + ((Math.floor(count / repeatNum) * increment) % span);
      }
      const rendered = decimals === 0 ? String(num) : String(num / scale);
      return (def.template || '%').replace(/%/g, rendered);
    }

    if (def.type === 'foreign.key') {
      const referenced = column.referencedColumns[0] ?? null;
      if (!referenced) {
        return null;
      }
      const values = this.valueList(referenced);
      if (values.length === 0) {
        return null;
      }
      return values[Math.floor(count / repeatNum) % values.length];
    }

    if (def.type === 'enum') {
      if (def.selects.length === 0) {
        return null;
      }
      return def.selects[Math.floor(count / repeatNum) % def.selects.length];
    }

    return null; // 'null' type or unknown
  }

  /** All generated values for a column, used by foreign-key repeat defs. */
  private valueList(column: ErmColumn): (string | null)[] {
    const cached = this.valueListCache.get(column);
    if (cached) {
      return cached;
    }
    const values: (string | null)[] = [];
    this.valueListCache.set(column, values); // break FK cycles

    const owner = this.set.tables.find(
      (t) => t.table && expandedColumns(t.table).includes(column),
    );
    if (owner && owner.table) {
      const directFirst = this.set.exportOrder !== '1';
      const repeatNum = parseInt(owner.repeatTestDataNum, 10) || 0;
      const pushDirect = () => {
        for (const row of owner.directRows) {
          const cell = row.find((c) => c.column === column);
          values.push(cell ? cell.value : null);
        }
      };
      const pushRepeat = () => {
        for (let i = 0; i < repeatNum; i++) {
          values.push(this.mergedRepeatValue(i, owner, column));
        }
      };
      if (directFirst) {
        pushDirect();
        pushRepeat();
      } else {
        pushRepeat();
        pushDirect();
      }
    }
    return values;
  }
}

function decimalPlaces(s: string): number {
  const i = s.indexOf('.');
  return i === -1 ? 0 : s.length - i - 1;
}
