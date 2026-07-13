import { ErmCategory, ErmColumn, ErmNode, ErmNote, ErmTable, ErmView, expandedColumns } from '../erm/model';
import { columnDisplayName, formatType, tableDisplayName, ViewMode } from '../erm/ops';

export const HEADER_H = 24;
export const ROW_H = 20;
export const CHAR_W = 7.0;
export const MIN_TABLE_W = 140;

export function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function nodeX(n: ErmNode): number {
  return parseInt(n.base.x, 10) || 0;
}

export function nodeY(n: ErmNode): number {
  return parseInt(n.base.y, 10) || 0;
}

/** Columns reordered so primary keys come first, as ERMaster draws them. */
export function orderedColumns(t: ErmTable | ErmView): ErmColumn[] {
  const cols = expandedColumns(t);
  const pk = cols.filter((c) => c.primaryKey === 'true');
  const rest = cols.filter((c) => c.primaryKey !== 'true');
  return [...pk, ...rest];
}

export function pkCount(t: ErmTable | ErmView): number {
  return expandedColumns(t).filter((c) => c.primaryKey === 'true').length;
}

export function boxWidth(n: ErmTable | ErmView, mode: ViewMode): number {
  let maxLen = tableDisplayName(n, mode).length + 3;
  for (const c of expandedColumns(n)) {
    maxLen = Math.max(maxLen, columnDisplayName(c, mode).length + formatType(c).length + 5);
  }
  return Math.max(MIN_TABLE_W, Math.round(maxLen * CHAR_W) + 22);
}

export function boxHeight(n: ErmTable | ErmView): number {
  return HEADER_H + Math.max(1, expandedColumns(n).length) * ROW_H;
}

export function noteWidth(n: ErmNote): number {
  return Math.max(120, parseInt(n.base.width, 10) || 0);
}

export function noteHeight(n: ErmNote): number {
  return Math.max(50, parseInt(n.base.height, 10) || 0);
}

export function nodeWidth(n: ErmNode, mode: ViewMode): number {
  if (n.kind === 'note' || n.kind === 'image') {
    return n.kind === 'note' ? noteWidth(n) : Math.max(80, parseInt(n.base.width, 10) || 0);
  }
  return boxWidth(n, mode);
}

export function nodeHeight(n: ErmNode): number {
  if (n.kind === 'note' || n.kind === 'image') {
    return n.kind === 'note' ? noteHeight(n) : Math.max(80, parseInt(n.base.height, 10) || 0);
  }
  return boxHeight(n);
}

export const CAT_PAD_X = 16;
export const CAT_PAD_TOP = 26;
export const CAT_PAD_BOTTOM = 16;

/** Bounding frame enclosing a category's member nodes (null if empty). */
export function categoryBounds(
  cat: ErmCategory,
  mode: ViewMode,
): { x: number; y: number; w: number; h: number } | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const node of cat.contents) {
    if (node.kind === 'image') {
      continue;
    }
    minX = Math.min(minX, nodeX(node));
    minY = Math.min(minY, nodeY(node));
    maxX = Math.max(maxX, nodeX(node) + nodeWidth(node, mode));
    maxY = Math.max(maxY, nodeY(node) + nodeHeight(node));
  }
  if (!isFinite(minX)) {
    return null;
  }
  return {
    x: minX - CAT_PAD_X,
    y: minY - CAT_PAD_TOP,
    w: maxX - minX + CAT_PAD_X * 2,
    h: maxY - minY + CAT_PAD_TOP + CAT_PAD_BOTTOM,
  };
}

/** Vertical center of a column's row, honoring the PK-first ordering. */
export function columnRowY(t: ErmTable | ErmView, col: ErmColumn): number {
  const idx = orderedColumns(t).indexOf(col);
  if (idx < 0) {
    return nodeY(t) + boxHeight(t) / 2;
  }
  return nodeY(t) + HEADER_H + idx * ROW_H + ROW_H / 2;
}
