import { ErmCategory, ErmNode, ErmNote, ErmRelation, ErmTable, ErmView, expandedColumns } from '../erm/model';
import { columnDisplayName, formatType, tableDisplayName, viewModeOf, ViewMode } from '../erm/ops';
import { app } from './state';
import {
  boxHeight,
  boxWidth,
  categoryBounds,
  columnRowY,
  esc,
  HEADER_H,
  nodeHeight,
  nodeWidth,
  nodeX,
  nodeY,
  noteHeight,
  noteWidth,
  orderedColumns,
  pkCount,
  ROW_H,
} from './geometry';

// Lazily resolved so this module can be imported in a non-DOM (test) context.
let _svg: SVGSVGElement | null = null;
function svgEl(): SVGSVGElement {
  return (_svg ??= document.getElementById('canvas') as unknown as SVGSVGElement);
}

/** Full scene markup (relations + nodes) without the pan/zoom wrapper. */
export function sceneMarkup(mode: ViewMode): string {
  if (!app.doc) {
    return '';
  }
  const parts: string[] = [];
  // category frames are the backmost layer
  for (const cat of app.doc.settings.categories) {
    parts.push(categorySvg(cat, mode));
  }
  // notes sit behind tables (like ERMaster)
  app.doc.contents.forEach((node, i) => {
    if (node.kind === 'note') {
      parts.push(noteSvg(node, i));
    }
  });
  for (const node of app.doc.contents) {
    if (node.kind === 'table' || node.kind === 'view') {
      for (const conn of node.base.incomings) {
        if (conn.kind === 'relation') {
          parts.push(relationSvg(conn, node, mode));
        }
      }
    }
  }
  // tables and views on top
  app.doc.contents.forEach((node, i) => {
    if (node.kind === 'table' || node.kind === 'view') {
      parts.push(boxSvg(node, i, mode));
    }
  });
  return parts.join('');
}

export function renderDiagram(): void {
  const svg = svgEl();
  if (!app.doc) {
    svg.innerHTML = '';
    return;
  }
  const mode = viewModeOf(app.doc);
  svg.innerHTML =
    `<g transform="translate(${app.view.x} ${app.view.y}) scale(${app.view.scale})">` +
    sceneMarkup(mode) +
    '</g>';
  const parseError = document.getElementById('parse-error');
  if (parseError) {
    parseError.textContent = app.parseError;
  }
}

export function showHint(text: string): void {
  const hint = document.getElementById('hint');
  if (hint) {
    hint.textContent = text;
    hint.classList.toggle('show', !!text);
  }
}

function boxSvg(t: ErmTable | ErmView, index: number, mode: ViewMode): string {
  const w = boxWidth(t, mode);
  const h = boxHeight(t);
  const cls =
    'node' +
    (t.kind === 'view' ? ' view' : '') +
    (index === app.selectedIndex ? ' selected' : '') +
    (index === app.relationSource ? ' rel-source' : '');
  const headerFill =
    t.kind === 'table' && t.base.color
      ? ` style="fill: rgb(${t.base.color.r},${t.base.color.g},${t.base.color.b})"`
      : '';

  const cols = orderedColumns(t);
  const nPk = pkCount(t);
  const rows: string[] = [];
  cols.forEach((c, i) => {
    const y = HEADER_H + i * ROW_H;
    const isPk = c.primaryKey === 'true';
    const isFk = c.referencedColumns.length > 0;
    const marker = isPk ? '\u{1F511}' : isFk ? '◇' : '';
    const nn = c.notNull === 'true' && !isPk;
    const name = columnDisplayName(c, mode) + (isFk ? ' (FK)' : '');
    const type = formatType(c) + (nn ? ' *' : '');
    rows.push(
      `<text class="col-marker" x="7" y="${y + 14}">${marker}</text>` +
        `<text class="col-name${isPk ? ' pk' : ''}" x="23" y="${y + 14}">${esc(name)}</text>` +
        `<text class="col-type" x="${w - 7}" y="${y + 14}" text-anchor="end">${esc(type)}</text>`,
    );
  });

  const sep =
    nPk > 0 && nPk < cols.length
      ? `<line class="pk-sep" x1="0" y1="${HEADER_H + nPk * ROW_H}" x2="${w}" y2="${HEADER_H + nPk * ROW_H}"/>`
      : '';

  return (
    `<g class="${cls}" data-index="${index}" transform="translate(${nodeX(t)} ${nodeY(t)})">` +
    `<rect class="tbl-body" x="0" y="0" width="${w}" height="${h}" rx="3"/>` +
    `<path class="tbl-header" d="M0 3 a3 3 0 0 1 3 -3 h${w - 6} a3 3 0 0 1 3 3 v${HEADER_H - 3} h${-w} z"${headerFill}/>` +
    `<text class="tbl-name" x="${w / 2}" y="${HEADER_H / 2 + 4}" text-anchor="middle">${esc(tableDisplayName(t, mode))}</text>` +
    sep +
    rows.join('') +
    `<rect class="tbl-hit" x="0" y="0" width="${w}" height="${h}" rx="3"/>` +
    `</g>`
  );
}

function noteSvg(n: ErmNote, index: number): string {
  const w = noteWidth(n);
  const h = noteHeight(n);
  const cls = 'node note' + (index === app.selectedIndex ? ' selected' : '');
  const fold = 12;
  const body = `M0 0 h${w - fold} l${fold} ${fold} v${h - fold} h${-w} z`;
  const foldPath = `M${w - fold} 0 v${fold} h${fold} z`;
  const bodyFill = n.base.color
    ? ` style="fill: rgb(${n.base.color.r},${n.base.color.g},${n.base.color.b})"`
    : '';
  const foldFill = n.base.color
    ? ` style="fill: rgb(${shade(n.base.color.r)},${shade(n.base.color.g)},${shade(n.base.color.b)})"`
    : '';
  const lineH = 15;
  const maxLines = Math.max(1, Math.floor((h - 10) / lineH));
  const lines = n.text.split('\n').slice(0, maxLines);
  const text = lines
    .map((l, i) => `<text class="note-text" x="7" y="${16 + i * lineH}">${esc(l)}</text>`)
    .join('');
  return (
    `<g class="${cls}" data-index="${index}" transform="translate(${nodeX(n)} ${nodeY(n)})">` +
    `<path class="note-body" d="${body}"${bodyFill}/>` +
    `<path class="note-fold" d="${foldPath}"${foldFill}/>` +
    text +
    `<rect class="tbl-hit" x="0" y="0" width="${w}" height="${h}"/>` +
    `</g>`
  );
}

/** Slightly darken a channel for the note's folded corner. */
function shade(v: string): number {
  return Math.max(0, (parseInt(v, 10) || 0) - 30);
}

function categorySvg(cat: ErmCategory, mode: ViewMode): string {
  const b = categoryBounds(cat, mode);
  if (!b) {
    return '';
  }
  const c = cat.base.color ?? { r: '181', g: '196', b: '223' };
  const fill = `rgb(${c.r},${c.g},${c.b})`;
  return (
    `<g class="category">` +
    `<rect class="cat-rect" x="${b.x}" y="${b.y}" width="${b.w}" height="${b.h}" rx="6" style="fill:${fill};stroke:${fill}"/>` +
    `<text class="cat-name" x="${b.x + 10}" y="${b.y + 17}" style="fill:${fill}">${esc(cat.name)}</text>` +
    `</g>`
  );
}

/**
 * Relation in IE (crow's foot) notation. Endpoints are clamped to the facing
 * edges of the two boxes; existing bendpoints are drawn as an orthogonal path.
 * Identifying relations (FK is part of the child PK) are solid, others dashed.
 */
function relationSvg(rel: ErmRelation, child: ErmTable | ErmView, mode: ViewMode): string {
  const parent = rel.source;
  if (!parent || (parent.kind !== 'table' && parent.kind !== 'view')) {
    return '';
  }
  const fkColumn = expandedColumns(child).find((c) => c.relations.includes(rel)) ?? null;
  const parentCols = expandedColumns(parent);
  const parentColumn =
    rel.referencedColumn ??
    fkColumn?.referencedColumns.find((c) => parentCols.includes(c)) ??
    parentCols.find((c) => c.primaryKey === 'true') ??
    null;

  const cw = nodeWidth(child, mode);
  const pw = nodeWidth(parent, mode);
  const cy = fkColumn ? columnRowY(child, fkColumn) : nodeY(child) + nodeHeight(child) / 2;
  const py = parentColumn ? columnRowY(parent, parentColumn) : nodeY(parent) + boxHeight(parent) / 2;

  const childCenter = nodeX(child) + cw / 2;
  const parentCenter = nodeX(parent) + pw / 2;
  const childDir = parentCenter >= childCenter ? 1 : -1;
  const parentDir = -childDir;
  const cx = childDir === 1 ? nodeX(child) + cw : nodeX(child);
  const px = parentDir === 1 ? nodeX(parent) + pw : nodeX(parent);

  const identifying = fkColumn?.primaryKey === 'true' || rel.referenceForPk === 'true';
  const crowLen = 12;
  const startX = cx + childDir * crowLen;
  const barGap = 9;
  const barX = px + parentDir * barGap;

  // path body: from crow base, through bendpoints (if any), to the parent bar
  let d = `M ${startX} ${cy}`;
  for (const bp of rel.bendpoints) {
    const bx = parseInt(bp.x, 10);
    const by = parseInt(bp.y, 10);
    if (!isNaN(bx) && !isNaN(by) && bp.relative !== 'true') {
      d += ` L ${bx} ${by}`;
    }
  }
  d += ` L ${barX} ${py} L ${px} ${py}`;

  // crow's foot at the child (many) side
  const many = rel.childCardinality !== '1';
  const crow = many
    ? `M ${startX} ${cy - 6} L ${cx} ${cy} M ${startX} ${cy} L ${cx} ${cy} M ${startX} ${cy + 6} L ${cx} ${cy}`
    : `M ${cx} ${cy - 6} L ${cx} ${cy + 6}`;
  // parent (one) side: a single bar; optional circle for 0..1
  const optional = rel.parentCardinality === '0..1';
  const bar = `<path class="rel-end" d="M ${barX} ${py - 6} L ${barX} ${py + 6}"/>`;
  const circle = optional
    ? `<circle class="rel-end" cx="${px + parentDir * (barGap + 5)}" cy="${py}" r="4"/>`
    : '';

  return (
    `<g class="relation">` +
    `<path class="rel-line${identifying ? '' : ' non-identifying'}" d="${d}"/>` +
    `<path class="rel-end" d="${crow}"/>` +
    bar +
    circle +
    `</g>`
  );
}

// ------------------------------------------------------------ export

const EXPORT_CSS = `
  .cat-rect { fill-opacity: 0.14; stroke-width: 1.5; }
  .cat-name { font-size: 12px; font-weight: 600; font-family: sans-serif; fill-opacity: 0.9; }
  .tbl-body { fill: #ffffff; stroke: #4a6a9a; stroke-width: 1; }
  .tbl-header { fill: #8080c0; }
  g.view .tbl-header { fill: #4f8f6f; }
  .tbl-name { fill: #ffffff; font-size: 12px; font-weight: 600; font-family: sans-serif; }
  .pk-sep { stroke: #4a6a9a; stroke-width: 1; }
  .col-marker { font-size: 10px; font-family: sans-serif; }
  .col-name { fill: #222; font-size: 12px; font-family: monospace; }
  .col-name.pk { font-weight: 600; }
  .col-type { fill: #777; font-size: 11px; font-family: monospace; }
  .tbl-hit { fill: transparent; stroke: none; }
  .rel-line { fill: none; stroke: #555; stroke-width: 1.5; }
  .rel-line.non-identifying { stroke-dasharray: 6 4; }
  .rel-end { fill: none; stroke: #555; stroke-width: 1.5; }
  .rel-end circle { fill: #fff; }
  .note-body { fill: #ffffce; stroke: #bbbb88; }
  .note-fold { fill: #e8e8a0; stroke: #bbbb88; }
  .note-text { fill: #333; font-size: 12px; font-family: sans-serif; }
`;

export function buildExportSvg(): string | null {
  if (!app.doc || app.doc.contents.length === 0) {
    return null;
  }
  const mode = viewModeOf(app.doc);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of app.doc.contents) {
    if (n.kind === 'image') {
      continue;
    }
    const w = nodeWidth(n, mode);
    const h = nodeHeight(n);
    minX = Math.min(minX, nodeX(n));
    minY = Math.min(minY, nodeY(n));
    maxX = Math.max(maxX, nodeX(n) + w);
    maxY = Math.max(maxY, nodeY(n) + h);
  }
  if (!isFinite(minX)) {
    return null;
  }
  const pad = 24;
  const width = Math.ceil(maxX - minX + pad * 2);
  const height = Math.ceil(maxY - minY + pad * 2);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<style>${EXPORT_CSS}</style>` +
    `<rect width="100%" height="100%" fill="#ffffff"/>` +
    `<g transform="translate(${pad - minX} ${pad - minY})">` +
    sceneMarkup(mode) +
    `</g></svg>`
  );
}

export { svgEl };
