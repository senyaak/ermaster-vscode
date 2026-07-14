import { ErmCategory, ErmCommentConnection, ErmImage, ErmNode, ErmNote, ErmRelation, ErmTable, ErmView, expandedColumns } from '../erm/model';
import { columnDisplayName, formatType, tableDisplayName, viewModeOf, ViewMode } from '../erm/ops';
import { app } from './state';
import {
  boxHeight,
  boxWidth,
  categoryBounds,
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
  // inserted images sit at the back (behind notes and tables)
  app.doc.contents.forEach((node, i) => {
    if (node.kind === 'image') {
      parts.push(imageSvg(node, i));
    }
  });
  // notes sit behind tables (like ERMaster)
  app.doc.contents.forEach((node, i) => {
    if (node.kind === 'note') {
      parts.push(noteSvg(node, i));
    }
  });
  // comment links (note ↔ table) sit under the relations
  for (const node of app.doc.contents) {
    for (const conn of node.base.incomings) {
      if (conn.kind === 'comment') {
        parts.push(commentSvg(conn, mode));
      }
    }
  }
  // relations: index matches ops.allRelations() so the webview can map a
  // clicked line back to its relation
  let relIndex = 0;
  for (const node of app.doc.contents) {
    if (node.kind === 'table' || node.kind === 'view') {
      for (const conn of node.base.incomings) {
        if (conn.kind === 'relation') {
          parts.push(relationSvg(conn, node, mode, relIndex));
          relIndex++;
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

/** Guess the image MIME type from the leading base64 bytes. */
function imageMime(base64: string): string {
  if (base64.startsWith('/9j/')) return 'image/jpeg';
  if (base64.startsWith('R0lGOD')) return 'image/gif';
  if (base64.startsWith('Qk')) return 'image/bmp';
  if (base64.startsWith('PHN2Zy') || base64.startsWith('PD94bWw')) return 'image/svg+xml';
  return 'image/png';
}

function imageSvg(img: ErmImage, index: number): string {
  const w = nodeWidth(img, 'physical');
  const h = nodeHeight(img);
  const cls = 'node image' + (index === app.selectedIndex ? ' selected' : '');
  // ERMaster image adjustments → CSS filter (hue 0..360, sat/bright -100..100, alpha 0..255)
  const hue = parseInt(img.hue, 10) || 0;
  const sat = parseInt(img.saturation, 10) || 0;
  const bright = parseInt(img.brightness, 10) || 0;
  const alpha = isNaN(parseInt(img.alpha, 10)) ? 255 : parseInt(img.alpha, 10);
  const filters: string[] = [];
  if (hue) filters.push(`hue-rotate(${hue}deg)`);
  if (sat) filters.push(`saturate(${Math.max(0, 1 + sat / 100)})`);
  if (bright) filters.push(`brightness(${Math.max(0, 1 + bright / 100)})`);
  const style =
    `opacity:${(alpha / 255).toFixed(3)}` + (filters.length ? `;filter:${filters.join(' ')}` : '');
  const href = img.data ? `data:${imageMime(img.data)};base64,${img.data}` : '';
  return (
    `<g class="${cls}" data-index="${index}" transform="translate(${nodeX(img)} ${nodeY(img)})">` +
    (href
      ? `<image href="${href}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="${
          img.fixAspectRatio === 'true' ? 'xMidYMid meet' : 'none'
        }" style="${style}"/>`
      : `<rect class="img-placeholder" x="0" y="0" width="${w}" height="${h}"/>`) +
    `<rect class="tbl-hit" x="0" y="0" width="${w}" height="${h}"/>` +
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

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function boxOf(node: ErmTable | ErmView, mode: ViewMode): Box {
  return { x: nodeX(node), y: nodeY(node), w: nodeWidth(node, mode), h: nodeHeight(node) };
}

function centerOf(b: Box): { x: number; y: number } {
  return { x: b.x + b.w / 2, y: b.y + b.h / 2 };
}

/** GEF ChopboxAnchor: the point on a box's edge along the center→reference line. */
function chopbox(b: Box, ref: { x: number; y: number }): { x: number; y: number } {
  const cx = b.x + b.w / 2;
  const cy = b.y + b.h / 2;
  const dx = ref.x - cx;
  const dy = ref.y - cy;
  if ((dx === 0 && dy === 0) || b.w === 0 || b.h === 0) {
    return { x: cx, y: cy };
  }
  const scale = 0.5 / Math.max(Math.abs(dx) / b.w, Math.abs(dy) / b.h);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

/** A manually-placed endpoint: xp/yp are percentages of the box, or -1 when unset. */
function customAnchor(b: Box, xp: string, yp: string): { x: number; y: number } | null {
  const x = parseInt(xp, 10);
  const y = parseInt(yp, 10);
  if (isNaN(x) || isNaN(y) || x < 0 || y < 0) {
    return null;
  }
  return { x: b.x + (b.w * x) / 100, y: b.y + (b.h * y) / 100 };
}

function norm(dx: number, dy: number): { x: number; y: number } {
  const len = Math.hypot(dx, dy);
  return len < 1e-6 ? { x: 1, y: 0 } : { x: dx / len, y: dy / len };
}

const round = (n: number): number => Math.round(n);

/** A short perpendicular tick centered at `c`, along direction `p`, of half-length `h`. */
function tick(c: { x: number; y: number }, p: { x: number; y: number }, h: number): string {
  return `M ${round(c.x + p.x * h)} ${round(c.y + p.y * h)} L ${round(c.x - p.x * h)} ${round(c.y - p.y * h)}`;
}

/**
 * Relation in IE (crow's foot) notation, routed the way ERMaster does: straight
 * segments between two ChopboxAnchors (or saved xp/yp endpoints) through the
 * bendpoints. Identifying relations (FK is part of the child PK) are solid.
 */
function relationSvg(rel: ErmRelation, child: ErmTable | ErmView, mode: ViewMode, index: number): string {
  const parent = rel.source;
  if (!parent || (parent.kind !== 'table' && parent.kind !== 'view')) {
    return '';
  }
  const fkColumn = expandedColumns(child).find((c) => c.relations.includes(rel)) ?? null;
  const identifying = fkColumn?.primaryKey === 'true' || rel.referenceForPk === 'true';

  // ERMaster routing: straight segments between two ChopboxAnchors. Each endpoint
  // is where the line to the other end crosses the table's edge (or a saved
  // xp/yp percentage point if the user dragged the endpoint). source = parent
  // (the "one" side), target = child (the crow's-foot "many" side).
  const parentBox = boxOf(parent, mode);
  const childBox = boxOf(child, mode);

  const bps = rel.bendpoints
    .map((bp, i) => ({ x: parseInt(bp.x, 10), y: parseInt(bp.y, 10), bpIndex: i, relative: bp.relative }))
    .filter((p) => !isNaN(p.x) && !isNaN(p.y) && p.relative !== 'true');

  const parentCustom = customAnchor(parentBox, rel.sourceXp, rel.sourceYp);
  const childCustom = customAnchor(childBox, rel.targetXp, rel.targetYp);
  const parentRef = parentCustom ?? centerOf(parentBox);
  const childRef = childCustom ?? centerOf(childBox);

  // GEF: source anchor aims at the first bendpoint (else the target's reference);
  // target anchor aims at the last bendpoint (else the source's reference).
  const S = parentCustom ?? chopbox(parentBox, bps[0] ?? childRef);
  const T = childCustom ?? chopbox(childBox, bps[bps.length - 1] ?? parentRef);

  // polyline vertices S → bendpoints → T (bpIndex is -1 for the two endpoints)
  const verts: { x: number; y: number; bpIndex: number }[] = [
    { x: S.x, y: S.y, bpIndex: -1 },
    ...bps.map((p) => ({ x: p.x, y: p.y, bpIndex: p.bpIndex })),
    { x: T.x, y: T.y, bpIndex: -1 },
  ];

  let d = `M ${round(verts[0].x)} ${round(verts[0].y)}`;
  for (let i = 1; i < verts.length; i++) {
    d += ` L ${round(verts[i].x)} ${round(verts[i].y)}`;
  }

  // decorations are oriented along each end's segment
  const beforeT = verts[verts.length - 2];
  const afterS = verts[1];
  const dT = norm(T.x - beforeT.x, T.y - beforeT.y); // points into the child table
  const dS = norm(S.x - afterS.x, S.y - afterS.y); // points into the parent table
  const pT = { x: -dT.y, y: dT.x };
  const pS = { x: -dS.y, y: dS.x };

  // child (many) end: crow's foot, or a single bar for a 1:1 child cardinality
  const many = rel.childCardinality !== '1';
  const crowLen = 11;
  const half = 6;
  const apex = { x: T.x - dT.x * crowLen, y: T.y - dT.y * crowLen };
  const crow = many
    ? `M ${round(apex.x + pT.x * half)} ${round(apex.y + pT.y * half)} L ${round(T.x)} ${round(T.y)} ` +
      `M ${round(apex.x)} ${round(apex.y)} L ${round(T.x)} ${round(T.y)} ` +
      `M ${round(apex.x - pT.x * half)} ${round(apex.y - pT.y * half)} L ${round(T.x)} ${round(T.y)}`
    : tick({ x: T.x - dT.x * 5, y: T.y - dT.y * 5 }, pT, half);

  // parent (one) end: a single bar, plus a circle for an optional (0..1) parent
  const optional = rel.parentCardinality === '0..1';
  const barGap = 8;
  const barC = { x: S.x - dS.x * barGap, y: S.y - dS.y * barGap };
  const bar = `<path class="rel-end" d="${tick(barC, pS, half)}"/>`;
  const circle = optional
    ? `<circle class="rel-end" cx="${round(S.x - dS.x * (barGap + 5))}" cy="${round(S.y - dS.y * (barGap + 5))}" r="4"/>`
    : '';

  const selected = app.selectedRelation === rel;
  // handles are drawn inside the zoom group, so counter-scale to keep them
  // a roughly constant on-screen size
  const r = 5 / app.view.scale;
  let handles = '';
  if (selected) {
    // existing bendpoints: draggable / double-click to remove
    for (const v of verts) {
      if (v.bpIndex >= 0) {
        handles += `<circle class="bp-handle" data-rel="${index}" data-bp="${v.bpIndex}" cx="${v.x}" cy="${v.y}" r="${r}"/>`;
      }
    }
    // segment midpoints: click to insert a new bendpoint before the next vertex
    for (let i = 0; i < verts.length - 1; i++) {
      const mx = (verts[i].x + verts[i + 1].x) / 2;
      const my = (verts[i].y + verts[i + 1].y) / 2;
      const insertAt = verts[i + 1].bpIndex >= 0 ? verts[i + 1].bpIndex : rel.bendpoints.length;
      handles += `<circle class="bp-add" data-rel="${index}" data-addbp="${insertAt}" cx="${round(mx)}" cy="${round(my)}" r="${r * 0.8}"/>`;
    }
  }

  return (
    `<g class="relation${selected ? ' selected' : ''}">` +
    `<path class="rel-hit" data-rel="${index}" d="${d}"/>` +
    `<path class="rel-line${identifying ? '' : ' non-identifying'}" d="${d}"/>` +
    `<path class="rel-end" d="${crow}"/>` +
    bar +
    circle +
    handles +
    `</g>`
  );
}

/** A note↔table comment link: a dashed line between the two boxes' edges. */
function commentSvg(conn: ErmCommentConnection, mode: ViewMode): string {
  const a = conn.source;
  const b = conn.target;
  if (!a || !b) {
    return '';
  }
  const boxA = anchorBox(a, mode);
  const boxB = anchorBox(b, mode);
  if (!boxA || !boxB) {
    return '';
  }
  const bps = conn.bendpoints
    .map((bp) => ({ x: parseInt(bp.x, 10), y: parseInt(bp.y, 10), relative: bp.relative }))
    .filter((p) => !isNaN(p.x) && !isNaN(p.y) && p.relative !== 'true');
  const pa = customAnchor(boxA, conn.sourceXp, conn.sourceYp) ?? chopbox(boxA, bps[0] ?? centerOf(boxB));
  const pb = customAnchor(boxB, conn.targetXp, conn.targetYp) ?? chopbox(boxB, bps[bps.length - 1] ?? centerOf(boxA));
  let d = `M ${round(pa.x)} ${round(pa.y)}`;
  for (const p of bps) {
    d += ` L ${round(p.x)} ${round(p.y)}`;
  }
  d += ` L ${round(pb.x)} ${round(pb.y)}`;
  return `<g class="comment"><path class="comment-line" d="${d}"/></g>`;
}

/** Bounding box of any node (tables/views/notes/images) for anchoring links. */
function anchorBox(node: ErmNode | null, mode: ViewMode): Box | null {
  if (!node) {
    return null;
  }
  return { x: nodeX(node), y: nodeY(node), w: nodeWidth(node, mode), h: nodeHeight(node) };
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
  .img-placeholder { fill: #eee; stroke: #bbb; stroke-dasharray: 4 3; }
  .comment-line { fill: none; stroke: #aa8; stroke-width: 1; stroke-dasharray: 2 3; }
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
