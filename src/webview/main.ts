import { ErmNode, ErmRelation } from '../erm/model';
import {
  addBendpoint,
  addImage,
  addNote,
  addTable,
  allRelations,
  createCommentConnection,
  createRelationAutoFk,
  deleteNode,
  moveBendpoint,
  removeBendpoint,
  removeRelation,
  setViewMode,
  DATABASE_IDS,
  ViewMode,
} from '../erm/ops';
import { app, commit, notify, onChange, post, ready, selectedNode, setDocFromText, Tool } from './state';
import { buildExportSvg, renderDiagram, showHint, svgEl } from './render';
import { closeDialog, isDialogOpen, openCategoriesDialog, openDialogFor, refreshDialog } from './dialogs';
import { nodeX, nodeY } from './geometry';

const svg = svgEl();
const canvasWrap = document.getElementById('canvas-wrap')!;
const palette = document.getElementById('palette')!;
const contextMenu = document.getElementById('context-menu')!;
const databaseSelect = document.getElementById('sel-database') as HTMLSelectElement;
const viewModeSelect = document.getElementById('sel-view-mode') as HTMLSelectElement;
const notationSelect = document.getElementById('sel-notation') as HTMLSelectElement;
const bezierButton = document.getElementById('btn-bezier') as HTMLButtonElement;

// ---------------------------------------------------------------- redraw wiring

onChange(() => {
  renderDiagram();
  refreshDialog();
  syncToolbar();
});

function syncToolbar(): void {
  if (!app.doc) {
    return;
  }
  if (databaseSelect.options.length === 0) {
    for (const id of DATABASE_IDS) {
      const opt = document.createElement('option');
      opt.value = id;
      opt.textContent = id;
      databaseSelect.appendChild(opt);
    }
  }
  databaseSelect.value = app.doc.settings.database;
  viewModeSelect.value = app.doc.settings.viewMode || '1';
  notationSelect.value = app.doc.settings.notation === 'IDEF1X' ? 'IDEF1X' : 'IE';
  bezierButton.classList.toggle('active', app.doc.settings.useBezierCurve === 'true');
}

// ---------------------------------------------------------------- messaging

window.addEventListener('message', (e) => {
  if (e.data?.type !== 'update') {
    return;
  }
  if (setDocFromText(e.data.text)) {
    notify();
  }
});

ready();

// ---------------------------------------------------------------- coordinates

function toDiagram(clientX: number, clientY: number): { x: number; y: number } {
  const rect = canvasWrap.getBoundingClientRect();
  return {
    x: (clientX - rect.left - app.view.x) / app.view.scale,
    y: (clientY - rect.top - app.view.y) / app.view.scale,
  };
}

function nodeIndexAt(target: EventTarget | null): number {
  const group = (target as Element | null)?.closest?.('g.node');
  return group ? parseInt(group.getAttribute('data-index') ?? '-1', 10) : -1;
}

// ---------------------------------------------------------------- palette / tools

function setTool(tool: Tool): void {
  app.tool = tool;
  app.relationSource = -1;
  app.selectedRelation = null;
  document.body.classList.toggle('tool-active', tool !== 'select');
  palette.querySelectorAll('.tool-btn').forEach((b) => {
    b.classList.toggle('active', (b as HTMLElement).dataset.tool === tool);
  });
  showHint(
    tool === 'relation'
      ? 'Click the parent table, then the child'
      : tool === 'table'
        ? 'Click to create a table'
        : tool === 'note'
          ? 'Click to create a note'
          : tool === 'image'
            ? 'Click where the image should go, then choose a file'
            : tool === 'comment'
              ? 'Click a note, then a table (or the other way round)'
              : '',
  );
  renderDiagram();
}

palette.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('.tool-btn') as HTMLElement | null;
  if (btn?.dataset.tool) {
    setTool(btn.dataset.tool as Tool);
  }
});

// ---------------------------------------------------------------- toolbar

viewModeSelect.addEventListener('change', () => {
  if (!app.doc) {
    return;
  }
  const map: Record<string, ViewMode> = { '0': 'logical', '1': 'physical', '2': 'both' };
  setViewMode(app.doc, map[viewModeSelect.value] ?? 'physical');
  commit();
});

databaseSelect.addEventListener('change', () => {
  if (!app.doc) {
    return;
  }
  app.doc.settings.database = databaseSelect.value;
  commit();
});

notationSelect.addEventListener('change', () => {
  if (!app.doc) {
    return;
  }
  app.doc.settings.notation = notationSelect.value;
  commit();
});

bezierButton.addEventListener('click', () => {
  if (!app.doc) {
    return;
  }
  app.doc.settings.useBezierCurve = app.doc.settings.useBezierCurve === 'true' ? 'false' : 'true';
  commit();
});

document.getElementById('btn-categories')!.addEventListener('click', () => openCategoriesDialog());
document.getElementById('btn-ddl')!.addEventListener('click', () => post({ type: 'generateDdl' }));
document.getElementById('btn-export-svg')!.addEventListener('click', exportSvg);
document.getElementById('btn-export-png')!.addEventListener('click', exportPng);

// ---------------------------------------------------------------- export

function exportSvg(): void {
  const s = buildExportSvg();
  if (s) {
    post({ type: 'exportSvg', svg: s });
  }
}

function exportPng(): void {
  const s = buildExportSvg();
  if (!s) {
    return;
  }
  const img = new Image();
  img.onload = () => {
    const scale = 2;
    const canvas = document.createElement('canvas');
    canvas.width = img.width * scale;
    canvas.height = img.height * scale;
    const ctx = canvas.getContext('2d')!;
    ctx.scale(scale, scale);
    ctx.drawImage(img, 0, 0);
    post({ type: 'exportPng', dataUrl: canvas.toDataURL('image/png') });
  };
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
}

// ---------------------------------------------------------------- image insert

function pickImage(x: number, y: number): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.onchange = () => {
    const file = input.files?.[0];
    if (!file || !app.doc) {
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = String(reader.result);
      const base64 = dataUrl.split(',')[1] ?? '';
      // read the natural size so the node starts at 1:1, capped to a sane box
      const probe = new Image();
      probe.onload = () => {
        if (!app.doc) {
          return;
        }
        const scale = Math.min(1, 400 / Math.max(1, probe.width), 400 / Math.max(1, probe.height));
        const node = addImage(app.doc, x, y, base64, probe.width * scale, probe.height * scale);
        app.selectedIndex = app.doc.contents.indexOf(node);
        commit();
      };
      probe.onerror = () => {
        if (!app.doc) {
          return;
        }
        const node = addImage(app.doc, x, y, base64, 160, 120);
        app.selectedIndex = app.doc.contents.indexOf(node);
        commit();
      };
      probe.src = dataUrl;
    };
    reader.readAsDataURL(file);
  };
  input.click();
}

// ---------------------------------------------------------------- pointer

interface DragState {
  kind: 'node' | 'pan' | 'bendpoint';
  index: number;
  startX: number;
  startY: number;
  node?: ErmNode;
  relation?: ErmRelation;
  bpIndex?: number;
  added?: boolean;
  origX: number;
  origY: number;
  moved: boolean;
}

let drag: DragState | null = null;

/** Resolve the relation referenced by a clicked handle / hit-path element. */
function relationAt(target: EventTarget | null): { rel: ErmRelation; el: Element } | null {
  const el = (target as Element | null)?.closest?.('[data-rel]');
  if (!el || !app.doc) {
    return null;
  }
  const rel = allRelations(app.doc)[parseInt(el.getAttribute('data-rel') ?? '-1', 10)];
  return rel ? { rel, el } : null;
}

svg.addEventListener('pointerdown', (e) => {
  if (e.button !== 0 || !app.doc) {
    return;
  }
  hideContextMenu();
  const index = nodeIndexAt(e.target);

  // creation tools act on click, not drag
  if (app.tool === 'table' || app.tool === 'note') {
    const p = toDiagram(e.clientX, e.clientY);
    const node = app.tool === 'table' ? addTable(app.doc, p.x - 70, p.y - 40) : addNote(app.doc, p.x - 80, p.y - 40, 'Note');
    app.selectedIndex = app.doc.contents.indexOf(node);
    setTool('select');
    commit();
    return;
  }
  if (app.tool === 'image') {
    const p = toDiagram(e.clientX, e.clientY);
    pickImage(p.x, p.y);
    setTool('select');
    return;
  }
  if (app.tool === 'relation') {
    handleRelationClick(index);
    return;
  }
  if (app.tool === 'comment') {
    handleCommentClick(index);
    return;
  }

  svg.setPointerCapture(e.pointerId);

  // relation editing takes priority over node/pan when a handle or line is hit
  const target = e.target as Element;
  const rel = relationAt(target);
  if (rel) {
    const p = toDiagram(e.clientX, e.clientY);
    if (target.classList.contains('bp-handle')) {
      const bpIndex = parseInt(target.getAttribute('data-bp') ?? '-1', 10);
      selectRelation(rel.rel);
      drag = { kind: 'bendpoint', index, startX: e.clientX, startY: e.clientY, relation: rel.rel, bpIndex, origX: p.x, origY: p.y, moved: false };
      e.preventDefault();
      return;
    }
    if (target.classList.contains('bp-add')) {
      const seg = parseInt(target.getAttribute('data-addbp') ?? '0', 10);
      addBendpoint(rel.rel, seg, p.x, p.y);
      selectRelation(rel.rel);
      drag = { kind: 'bendpoint', index, startX: e.clientX, startY: e.clientY, relation: rel.rel, bpIndex: seg, origX: p.x, origY: p.y, moved: false, added: true };
      e.preventDefault();
      return;
    }
    // clicked the line itself: just select the relation
    selectRelation(rel.rel);
    drag = { kind: 'pan', index: -1, startX: e.clientX, startY: e.clientY, origX: app.view.x, origY: app.view.y, moved: false };
    e.preventDefault();
    return;
  }

  if (index >= 0) {
    const node = app.doc.contents[index];
    clearRelationSelection();
    drag = { kind: 'node', index, startX: e.clientX, startY: e.clientY, node, origX: nodeX(node), origY: nodeY(node), moved: false };
  } else {
    drag = { kind: 'pan', index: -1, startX: e.clientX, startY: e.clientY, origX: app.view.x, origY: app.view.y, moved: false };
  }
  e.preventDefault();
});

function selectRelation(rel: ErmRelation): void {
  app.selectedRelation = rel;
  app.selectedIndex = -1;
  renderDiagram();
}

function clearRelationSelection(): void {
  if (app.selectedRelation) {
    app.selectedRelation = null;
    renderDiagram();
  }
}

svg.addEventListener('pointermove', (e) => {
  if (!drag) {
    return;
  }
  const dx = e.clientX - drag.startX;
  const dy = e.clientY - drag.startY;
  if (Math.abs(dx) + Math.abs(dy) > 3) {
    drag.moved = true;
  }
  if (!drag.moved) {
    return;
  }
  if (drag.kind === 'bendpoint' && drag.relation && drag.bpIndex !== undefined) {
    moveBendpoint(drag.relation, drag.bpIndex, drag.origX + dx / app.view.scale, drag.origY + dy / app.view.scale);
    renderDiagram();
  } else if (drag.kind === 'node' && drag.node) {
    drag.node.base.x = String(Math.round(drag.origX + dx / app.view.scale));
    drag.node.base.y = String(Math.round(drag.origY + dy / app.view.scale));
    renderDiagram();
  } else {
    app.view.x = drag.origX + dx;
    app.view.y = drag.origY + dy;
    renderDiagram();
  }
});

svg.addEventListener('pointerup', (e) => {
  if (svg.hasPointerCapture(e.pointerId)) {
    svg.releasePointerCapture(e.pointerId);
  }
  if (!drag) {
    return;
  }
  const d = drag;
  drag = null;
  if (d.kind === 'bendpoint') {
    if (d.moved || d.added) {
      commit();
    }
  } else if (d.kind === 'node') {
    if (d.moved) {
      commit();
    } else if (app.selectedIndex !== d.index) {
      app.selectedIndex = d.index;
      clearRelationSelection();
      renderDiagram();
    }
  } else if (!d.moved && app.selectedIndex >= 0) {
    app.selectedIndex = -1;
    renderDiagram();
  } else if (!d.moved && app.selectedRelation && !relationAt(e.target)) {
    // clicked empty space: drop the relation selection
    clearRelationSelection();
  }
});

svg.addEventListener('pointercancel', () => {
  drag = null;
});

svg.addEventListener('dblclick', (e) => {
  // double-clicking a bendpoint handle removes that bendpoint
  const target = e.target as Element;
  if (target.classList.contains('bp-handle')) {
    const rel = relationAt(target);
    if (rel) {
      removeBendpoint(rel.rel, parseInt(target.getAttribute('data-bp') ?? '-1', 10));
      commit();
    }
    return;
  }
  const index = nodeIndexAt(e.target);
  if (index >= 0 && app.doc) {
    app.selectedIndex = index;
    openDialogFor(app.doc.contents[index]);
  }
});

function handleRelationClick(index: number): void {
  if (!app.doc || index < 0) {
    if (index < 0) {
      setTool('select'); // clicking empty space cancels
    }
    return;
  }
  const node = app.doc.contents[index];
  if (node.kind !== 'table') {
    return;
  }
  if (app.relationSource < 0) {
    app.relationSource = index;
    showHint(`Parent: ${node.physicalName || node.logicalName}. Now click the child table.`);
    renderDiagram();
    return;
  }
  const parent = app.doc.contents[app.relationSource];
  if (parent && parent.kind === 'table' && parent !== node) {
    const rel = createRelationAutoFk(parent, node);
    if (!rel) {
      showHint('The parent table has no primary key');
    }
  }
  setTool('select');
  commit();
}

function handleCommentClick(index: number): void {
  if (!app.doc || index < 0) {
    if (index < 0) {
      setTool('select'); // clicking empty space cancels
    }
    return;
  }
  const node = app.doc.contents[index];
  if (app.relationSource < 0) {
    app.relationSource = index;
    showHint(
      node.kind === 'note'
        ? 'Now click the table to link this note to'
        : 'Now click the note to link this table to',
    );
    renderDiagram();
    return;
  }
  const first = app.doc.contents[app.relationSource];
  if (first && first !== node) {
    const conn = createCommentConnection(first, node);
    if (!conn) {
      showHint('A comment link must connect a note with a table');
    }
  }
  setTool('select');
  commit();
}

// ---------------------------------------------------------------- wheel zoom

canvasWrap.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
    const newScale = Math.min(3, Math.max(0.2, app.view.scale * factor));
    const rect = canvasWrap.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    app.view.x = mx - ((mx - app.view.x) / app.view.scale) * newScale;
    app.view.y = my - ((my - app.view.y) / app.view.scale) * newScale;
    app.view.scale = newScale;
    renderDiagram();
  },
  { passive: false },
);

// ---------------------------------------------------------------- context menu

svg.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  if (!app.doc) {
    return;
  }
  const index = nodeIndexAt(e.target);
  const p = toDiagram(e.clientX, e.clientY);
  const items: { label: string; danger?: boolean; run: () => void }[] = [];

  if (index >= 0) {
    app.selectedIndex = index;
    renderDiagram();
    const node = app.doc.contents[index];
    items.push({ label: 'Edit…', run: () => openDialogFor(node) });
    if (node.kind === 'table') {
      items.push({
        label: 'Add child table (1:n)',
        run: () => {
          const child = addTable(app.doc!, nodeX(node) + 260, nodeY(node));
          createRelationAutoFk(node, child);
          commit();
        },
      });
    }
    items.push({
      label: 'Delete',
      danger: true,
      run: () => {
        deleteNode(app.doc!, node);
        if (app.selectedIndex === index) {
          app.selectedIndex = -1;
        }
        commit();
      },
    });
  } else {
    items.push({ label: 'New table here', run: () => { const n = addTable(app.doc!, p.x, p.y); app.selectedIndex = app.doc!.contents.indexOf(n); commit(); } });
    items.push({ label: 'New note here', run: () => { const n = addNote(app.doc!, p.x, p.y, 'Note'); app.selectedIndex = app.doc!.contents.indexOf(n); commit(); } });
    items.push({ label: 'Export PNG', run: exportPng });
    items.push({ label: 'Export SVG', run: exportSvg });
  }

  showContextMenu(e.clientX, e.clientY, items);
});

function showContextMenu(x: number, y: number, items: { label: string; danger?: boolean; run: () => void }[]): void {
  contextMenu.innerHTML = items
    .map((it, i) => `<div class="ctx-item${it.danger ? ' danger' : ''}" data-i="${i}">${it.label}</div>`)
    .join('');
  contextMenu.style.left = `${x}px`;
  contextMenu.style.top = `${y}px`;
  contextMenu.classList.remove('hidden');
  const onClick = (ev: MouseEvent) => {
    const el = (ev.target as HTMLElement).closest('.ctx-item') as HTMLElement | null;
    if (el) {
      items[parseInt(el.dataset.i!, 10)].run();
    }
    hideContextMenu();
  };
  contextMenu.onclick = onClick;
}

function hideContextMenu(): void {
  contextMenu.classList.add('hidden');
  contextMenu.onclick = null;
}

window.addEventListener('pointerdown', (e) => {
  if (!contextMenu.classList.contains('hidden') && !contextMenu.contains(e.target as Node)) {
    hideContextMenu();
  }
});

// ---------------------------------------------------------------- keyboard

window.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    if (isDialogOpen()) {
      closeDialog();
    } else if (app.tool !== 'select') {
      setTool('select');
    } else if (app.selectedRelation) {
      clearRelationSelection();
    } else if (app.selectedIndex >= 0) {
      app.selectedIndex = -1;
      renderDiagram();
    }
    return;
  }
  if (isDialogOpen()) {
    return;
  }
  const activeTag = (document.activeElement?.tagName || '').toLowerCase();
  if (activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select') {
    return;
  }
  if ((e.key === 'Delete' || e.key === 'Backspace') && app.selectedRelation && app.doc) {
    removeRelation(app.doc, app.selectedRelation);
    app.selectedRelation = null;
    commit();
    e.preventDefault();
  } else if ((e.key === 'Delete' || e.key === 'Backspace') && app.selectedIndex >= 0 && app.doc) {
    const node = selectedNode();
    if (node) {
      deleteNode(app.doc, node);
      app.selectedIndex = -1;
      commit();
    }
    e.preventDefault();
  } else if (e.key === 'v' || e.key === 's') {
    setTool('select');
  } else if (e.key === 't') {
    setTool('table');
  } else if (e.key === 'n') {
    setTool('note');
  } else if (e.key === 'r') {
    setTool('relation');
  }
});

renderDiagram();
