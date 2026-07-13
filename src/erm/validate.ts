import { ErmDiagram, expandedColumns, isTable } from './model';
import { columnName, formatType } from './ops';

export interface ValidationIssue {
  severity: 'error' | 'warning';
  message: string;
  /**
   * A literal string from the XML the issue anchors to (e.g. the table's
   * physical_name element) — the editor host locates it in the document text.
   */
  anchor: string | null;
}

/** Model validation, following ERMaster's validator rules. */
export function validateDiagram(diagram: ErmDiagram): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const tables = diagram.contents.filter(isTable);

  const tableAnchor = (physicalName: string) =>
    physicalName ? `<physical_name>${physicalName}</physical_name>` : null;

  const namesSeen = new Map<string, number>();
  for (const table of tables) {
    const name = table.physicalName.trim();
    namesSeen.set(name.toLowerCase(), (namesSeen.get(name.toLowerCase()) ?? 0) + 1);
  }

  for (const table of tables) {
    const name = table.physicalName.trim();
    const anchor = tableAnchor(table.physicalName);

    if (!name) {
      issues.push({
        severity: 'error',
        message: `Table has no physical name (logical: "${table.logicalName || '?'}")`,
        anchor: null,
      });
    } else if ((namesSeen.get(name.toLowerCase()) ?? 0) > 1) {
      issues.push({
        severity: 'error',
        message: `Duplicate table name: "${name}"`,
        anchor,
      });
    }

    const columns = expandedColumns(table);
    if (columns.length === 0) {
      issues.push({
        severity: 'warning',
        message: `Table "${name || table.logicalName}" has no columns`,
        anchor,
      });
    }

    const colNames = new Map<string, number>();
    for (const col of columns) {
      const cn = columnName(col).trim();
      colNames.set(cn.toLowerCase(), (colNames.get(cn.toLowerCase()) ?? 0) + 1);
    }
    for (const col of columns) {
      const cn = columnName(col).trim();
      if (!cn) {
        issues.push({
          severity: 'error',
          message: `Column has no name in table "${name}"`,
          anchor,
        });
      } else if ((colNames.get(cn.toLowerCase()) ?? 0) > 1) {
        issues.push({
          severity: 'error',
          message: `Duplicate column "${cn}" in table "${name}"`,
          anchor,
        });
        colNames.set(cn.toLowerCase(), 0); // report once
      }
      if (!formatType(col)) {
        issues.push({
          severity: 'warning',
          message: `Column "${cn}" in table "${name}" has no type`,
          anchor,
        });
      }
    }

    if (columns.length > 0 && !columns.some((c) => c.primaryKey === 'true')) {
      issues.push({
        severity: 'warning',
        message: `Table "${name || table.logicalName}" has no primary key`,
        anchor,
      });
    }
  }

  return issues;
}
