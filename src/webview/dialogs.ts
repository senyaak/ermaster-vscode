import { ErmColumn, ErmColumnGroup, ErmImage, ErmNode, ErmNote, ErmTable, ErmView, expandedColumns } from '../erm/model';
import {
  addCategory,
  addColumn,
  addColumnGroup,
  addColumnToGroup,
  addComplexUniqueKey,
  addDirectRow,
  addIndex,
  addViewColumn,
  deleteCategory,
  deleteColumnGroup,
  deleteDirectRow,
  deleteViewColumn,
  ensureTableTestData,
  ensureTestData,
  setDirectCell,
  removeColumnFromGroup,
  tableHasGroup,
  toggleTableGroup,
  toggleCategoryNode,
  columnLogicalName,
  columnName,
  columnRelation,
  createRelation,
  deleteColumn,
  deleteComplexUniqueKey,
  deleteNode,
  formatType,
  hexToRgb,
  KNOWN_TYPE_IDS,
  moveColumnItem,
  removeRelation,
  rgbToHex,
  setColumnName,
  setColumnType,
  toggleCukColumn,
  toggleIndexColumn,
} from '../erm/ops';
import { app, commit } from './state';
import { esc } from './geometry';

const root = document.getElementById('dialog-root')!;

function clampInt(value: string, min: number, max: number): string {
  const n = parseInt(value, 10);
  return String(isNaN(n) ? min : Math.max(min, Math.min(max, n)));
}

interface DialogState {
  node?: ErmNode;
  tab: string;
  categories?: boolean;
}

let current: DialogState | null = null;

export function openDialogFor(node: ErmNode): void {
  const tab = node.kind === 'table' ? 'attrs' : node.kind === 'view' ? 'view' : 'note';
  current = { node, tab };
  renderDialog();
}

export function openCategoriesDialog(): void {
  current = { categories: true, tab: 'categories' };
  renderDialog();
}

export function closeDialog(): void {
  current = null;
  root.innerHTML = '';
}

export function isDialogOpen(): boolean {
  return current !== null;
}

/** Rebuild the dialog if its target still exists (called after edits). */
export function refreshDialog(): void {
  if (!current) {
    return;
  }
  if (current.categories) {
    if (!app.doc) {
      closeDialog();
      return;
    }
    renderDialog();
    return;
  }
  if (!app.doc || !current.node || !app.doc.contents.includes(current.node)) {
    closeDialog();
    return;
  }
  renderDialog();
}

function renderDialog(): void {
  if (!current) {
    return;
  }

  if (current.categories) {
    root.innerHTML = `
      <div class="modal-overlay" data-overlay>
        <div class="modal">
          <div class="modal-header">Categories</div>
          <div class="modal-body">${categoriesBody()}</div>
          <div class="modal-footer">
            <button data-action="close">Close</button>
          </div>
        </div>
      </div>`;
    return;
  }

  const node = current.node!;
  let title = 'Edit';
  let tabs = '';
  let body = '';

  if (node.kind === 'table') {
    title = `Table: ${node.physicalName || node.logicalName || '(unnamed)'}`;
    tabs = tabBar([
      ['attrs', 'Attributes'],
      ['columns', 'Columns'],
      ['groups', 'Groups'],
      ['indexes', 'Indexes'],
      ['unique', 'Unique Keys'],
      ['relations', 'Relations'],
      ['testdata', 'Test Data'],
    ]);
    body = tableTabBody(node);
  } else if (node.kind === 'view') {
    title = `View: ${node.physicalName || '(unnamed)'}`;
    body = viewBody(node);
  } else if (node.kind === 'note') {
    title = 'Note';
    body = noteBody(node);
  } else {
    title = 'Image';
    body = imageBody(node);
  }

  root.innerHTML = `
    <div class="modal-overlay" data-overlay>
      <div class="modal">
        <div class="modal-header">${esc(title)}</div>
        ${tabs}
        <div class="modal-body">${body}</div>
        <div class="modal-footer">
          <button class="secondary" data-action="delete-node">Delete</button>
          <button data-action="close">Close</button>
        </div>
      </div>
    </div>`;
}

function categoriesBody(): string {
  if (!app.doc) {
    return '';
  }
  const nodes = app.doc.contents
    .map((n, i) => ({ n, i }))
    .filter(({ n }) => n.kind === 'table' || n.kind === 'view');
  const cats = app.doc.settings.categories
    .map((cat, ki) => {
      const checks = nodes
        .map(({ n, i }) => {
          const label = n.kind === 'note' || n.kind === 'image' ? '' : n.physicalName || n.logicalName || `#${i}`;
          return `<label style="display:inline-flex;align-items:center;gap:3px;margin:0 10px 4px 0"><input type="checkbox" data-cat="${ki}" data-cat-node="${i}"${cat.contents.includes(n) ? ' checked' : ''}> ${esc(label)}</label>`;
        })
        .join('');
      return `<div class="col-row">
        <div class="col-row-main">
          <input type="text" data-cat="${ki}" data-field="cat-name" value="${esc(cat.name)}" placeholder="category name">
          <input type="color" data-cat="${ki}" data-field="cat-color" value="${rgbToHex(cat.base.color)}">
          <button class="icon-btn" data-action="cat-del" data-cat="${ki}" title="Delete">✕</button>
        </div>
        <div class="col-row-flags">${checks || '<span class="hint-row">No tables.</span>'}</div>
      </div>`;
    })
    .join('');
  return `
    <div class="grid-toolbar"><button data-action="add-cat">+ Category</button></div>
    ${cats || '<div class="hint-row">No categories yet. A category draws a colored frame around the selected tables.</div>'}`;
}

function tabBar(tabs: [string, string][]): string {
  return (
    '<div class="modal-tabs">' +
    tabs
      .map(([id, label]) => `<div class="tab${current!.tab === id ? ' active' : ''}" data-tab="${id}">${label}</div>`)
      .join('') +
    '</div>'
  );
}

function tableTabBody(t: ErmTable): string {
  switch (current!.tab) {
    case 'columns':
      return columnsGrid(t);
    case 'groups':
      return groupsGrid(t);
    case 'indexes':
      return indexesGrid(t);
    case 'unique':
      return uniqueGrid(t);
    case 'relations':
      return relationsGrid(t);
    case 'testdata':
      return testDataGrid(t);
    default:
      return attrsBody(t);
  }
}

/** Direct test-data rows for this table (columns × rows editable grid). */
function testDataGrid(t: ErmTable): string {
  const cols = expandedColumns(t);
  const set = app.doc?.testDataList[0];
  const td = set?.tables.find((x) => x.table === t);
  const rows = (td?.directRows ?? [])
    .map((row, ri) => {
      const cells = cols
        .map((c, ci) => {
          const value = row.find((cell) => cell.column === c)?.value ?? '';
          return `<td><input type="text" data-field="td-cell" data-td-row="${ri}" data-td-col="${ci}" value="${esc(value)}"></td>`;
        })
        .join('');
      return `<tr data-td-row="${ri}">${cells}<td class="center"><button class="icon-btn" data-action="td-del-row" title="Delete row">✕</button></td></tr>`;
    })
    .join('');
  const head = cols.map((c) => `<th>${esc(columnName(c))}</th>`).join('');
  return `
    <div class="grid-toolbar"><button data-action="td-add-row">+ Row</button></div>
    <table class="grid">
      <thead><tr>${head}<th></th></tr></thead>
      <tbody>${rows || `<tr><td colspan="${cols.length + 1}" class="hint-row">No test data rows. Values are emitted as quoted strings; use <code>null</code> for NULL.</td></tr>`}</tbody>
    </table>
    <div class="hint-row">Generate INSERTs with the <strong>Data</strong> toolbar button.</div>`;
}

const TYPE_DATALIST = `<datalist id="type-list">${KNOWN_TYPE_IDS.map(
  (ty) => `<option value="${ty.replace('(n)', '(255)').replace('(p,s)', '(10,2)')}">`,
).join('')}</datalist>`;

/**
 * Reusable column groups (ERMaster's <column_groups>). Groups are diagram-wide;
 * their columns are shared by every table that includes the group. The checkbox
 * attaches / detaches the group on this table.
 */
function groupsGrid(t: ErmTable): string {
  if (!app.doc) {
    return '';
  }
  const groups = app.doc.columnGroups
    .map((g, gi) => {
      const cols = g.columns
        .map(
          (c, gci) => `<tr data-group="${gi}" data-gcol="${gci}">
          <td><input type="text" data-field="g-name" value="${esc(columnName(c))}"></td>
          <td><input type="text" data-field="g-type" value="${esc(formatType(c))}" list="type-list"></td>
          <td class="center"><input type="checkbox" data-field="g-nn"${c.notNull === 'true' ? ' checked' : ''}></td>
          <td class="center"><button class="icon-btn" data-action="group-col-del" title="Remove column">✕</button></td>
        </tr>`,
        )
        .join('');
      return `<div class="col-row">
        <div class="col-row-main">
          <label class="grp-attach"><input type="checkbox" data-group="${gi}" data-field="group-attach"${
            tableHasGroup(t, g) ? ' checked' : ''
          }> in this table</label>
          <input type="text" data-group="${gi}" data-field="group-name" value="${esc(g.groupName)}" placeholder="group name">
          <button class="icon-btn" data-action="group-del" data-group="${gi}" title="Delete group">✕</button>
        </div>
        <table class="grid">
          <thead><tr><th>Physical</th><th>Type</th><th>NN</th><th></th></tr></thead>
          <tbody>${cols || '<tr><td colspan="4" class="hint-row">No columns.</td></tr>'}</tbody>
        </table>
        <div class="grid-toolbar"><button data-action="group-add-col" data-group="${gi}">+ Column</button></div>
      </div>`;
    })
    .join('');
  return `
    <div class="grid-toolbar"><button data-action="add-group">+ Group</button></div>
    ${groups || '<div class="hint-row">No column groups yet. A group is a reusable set of columns you can add to several tables at once.</div>'}
    ${TYPE_DATALIST}`;
}

function attrsBody(t: ErmTable): string {
  return `
    <div class="field">
      <label>Physical name</label>
      <input type="text" data-field="physicalName" value="${esc(t.physicalName)}">
    </div>
    <div class="field">
      <label>Logical name</label>
      <input type="text" data-field="logicalName" value="${esc(t.logicalName)}">
    </div>
    <div class="field">
      <label>Description</label>
      <textarea rows="3" data-field="description">${esc(t.description)}</textarea>
    </div>
    <div class="field row">
      <label>Header color</label>
      <input type="color" data-field="color" value="${rgbToHex(t.base.color)}">
    </div>`;
}

function fkOptions(current: ErmTable, selected: string): string {
  let html = `<option value="">—</option>`;
  if (!app.doc) {
    return html;
  }
  app.doc.contents.forEach((node, ti) => {
    if (node.kind !== 'table' || node === current) {
      return;
    }
    expandedColumns(node).forEach((c, ci) => {
      if (c.primaryKey === 'true' || c.uniqueKey === 'true') {
        const value = `${ti}:${ci}`;
        html += `<option value="${value}"${value === selected ? ' selected' : ''}>${esc(node.physicalName)}.${esc(columnName(c))}</option>`;
      }
    });
  });
  return html;
}

function columnsGrid(t: ErmTable): string {
  const columns = expandedColumns(t);
  const ownColumns = t.columns
    .filter((i): i is { kind: 'column'; column: ErmColumn } => i.kind === 'column')
    .map((i) => i.column);

  const rows = columns
    .map((c, ci) => {
      const own = ownColumns.includes(c);
      const isFk = c.referencedColumns.length > 0;
      const rel = columnRelation(c);
      let fkValue = '';
      if (rel && rel.source && app.doc) {
        const ti = app.doc.contents.indexOf(rel.source);
        const parentCols = rel.source.kind === 'table' ? expandedColumns(rel.source) : [];
        const parentCol = rel.referencedColumn ?? c.referencedColumns.find((rc) => parentCols.includes(rc)) ?? null;
        const pci = parentCol ? parentCols.indexOf(parentCol) : -1;
        if (ti >= 0 && pci >= 0) {
          fkValue = `${ti}:${pci}`;
        }
      }
      const dis = own ? '' : ' disabled';
      const ownIndex = own ? t.columns.findIndex((i) => i.kind === 'column' && i.column === c) : -1;
      return `<tr data-col="${ci}" data-own="${ownIndex}">
        <td><input type="text" data-field="name" value="${esc(columnName(c))}"${dis}></td>
        <td><input type="text" data-field="logicalName" value="${esc(own ? columnLogicalName(c) : columnLogicalName(c))}"${dis}></td>
        <td><input type="text" data-field="type" value="${esc(formatType(c))}" list="type-list"${isFk || !own ? ' disabled' : ''}></td>
        <td class="center"><input type="checkbox" data-field="primaryKey"${c.primaryKey === 'true' ? ' checked' : ''}${dis}></td>
        <td class="center"><input type="checkbox" data-field="notNull"${c.notNull === 'true' ? ' checked' : ''}${dis}></td>
        <td class="center"><input type="checkbox" data-field="uniqueKey"${c.uniqueKey === 'true' ? ' checked' : ''}${dis}></td>
        <td><select data-field="fk"${dis}>${fkOptions(t, fkValue)}</select></td>
        <td><input type="text" data-field="defaultValue" value="${esc(c.defaultValue)}"${dis}></td>
        <td class="center"><button class="icon-btn" data-action="col-up" title="Up"${own ? '' : ' disabled'}>↑</button></td>
        <td class="center"><button class="icon-btn" data-action="col-down" title="Down"${own ? '' : ' disabled'}>↓</button></td>
        <td class="center"><button class="icon-btn" data-action="col-del" title="Delete"${own ? '' : ' disabled'}>✕</button></td>
      </tr>`;
    })
    .join('');

  return `
    ${TYPE_DATALIST}
    <div class="grid-toolbar"><button data-action="add-col">+ Column</button></div>
    <table class="grid">
      <thead><tr>
        <th>Physical</th><th>Logical</th><th>Type</th>
        <th>PK</th><th>NN</th><th>UQ</th><th>FK</th><th>Default</th>
        <th></th><th></th><th></th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="hint-row">FK columns inherit their name/type from the parent; mark PK to make the relation identifying.</div>`;
}

function indexesGrid(t: ErmTable): string {
  const columns = expandedColumns(t);
  const rows = t.indexes
    .map((idx, ii) => {
      const checks = columns
        .map(
          (c, ci) =>
            `<label style="margin-right:8px"><input type="checkbox" data-idx="${ii}" data-idx-col="${ci}"${idx.columns.some((x) => x.column === c) ? ' checked' : ''}> ${esc(columnName(c))}</label>`,
        )
        .join('');
      return `<tr data-idx="${ii}">
        <td><input type="text" data-field="idx-name" value="${esc(idx.name)}"></td>
        <td class="center"><input type="checkbox" data-field="idx-unique"${idx.nonUnique === 'true' ? '' : ' checked'}></td>
        <td>${checks}</td>
        <td class="center"><button class="icon-btn" data-action="idx-del">✕</button></td>
      </tr>`;
    })
    .join('');
  return `
    <div class="grid-toolbar"><button data-action="add-idx">+ Index</button></div>
    <table class="grid">
      <thead><tr><th>Name</th><th>Unique</th><th>Columns</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" class="hint-row">No indexes.</td></tr>'}</tbody>
    </table>`;
}

function uniqueGrid(t: ErmTable): string {
  const columns = expandedColumns(t);
  const rows = t.complexUniqueKeys
    .map((cuk, ki) => {
      const checks = columns
        .map(
          (c, ci) =>
            `<label style="margin-right:8px"><input type="checkbox" data-cuk="${ki}" data-cuk-col="${ci}"${cuk.columns.includes(c) ? ' checked' : ''}> ${esc(columnName(c))}</label>`,
        )
        .join('');
      return `<tr data-cuk="${ki}">
        <td><input type="text" data-field="cuk-name" value="${esc(cuk.name)}"></td>
        <td>${checks}</td>
        <td class="center"><button class="icon-btn" data-action="cuk-del">✕</button></td>
      </tr>`;
    })
    .join('');
  return `
    <div class="grid-toolbar"><button data-action="add-cuk">+ Unique Key</button></div>
    <table class="grid">
      <thead><tr><th>Constraint name</th><th>Columns</th><th></th></tr></thead>
      <tbody>${rows || '<tr><td colspan="3" class="hint-row">No composite keys.</td></tr>'}</tbody>
    </table>`;
}

function relationsGrid(t: ErmTable): string {
  const cardOpts = (opts: string[], value: string) =>
    opts.map((o) => `<option value="${o}"${o === value ? ' selected' : ''}>${o}</option>`).join('');
  const actions = ['RESTRICT', 'NO ACTION', 'CASCADE', 'SET NULL', 'SET DEFAULT'];
  const rows = t.base.incomings
    .map((conn, ri) => {
      if (conn.kind !== 'relation' || !conn.source) {
        return '';
      }
      const fkCols = expandedColumns(t).filter((c) => c.relations.includes(conn));
      const label = `${fkCols.map((c) => columnName(c)).join(', ')} → ${conn.source.kind !== 'note' && conn.source.kind !== 'image' ? conn.source.physicalName : ''}`;
      return `<tr data-rel="${ri}">
        <td>${esc(label)}</td>
        <td><input type="text" data-field="rel-name" value="${esc(conn.name)}" placeholder="constraint"></td>
        <td><select data-field="rel-parent-card">${cardOpts(['1', '0..1'], conn.parentCardinality || '1')}</select></td>
        <td><select data-field="rel-child-card">${cardOpts(['1..n', '0..n', '1', '0..1'], conn.childCardinality || '1..n')}</select></td>
        <td><select data-field="rel-on-delete">${cardOpts(actions, conn.onDeleteAction || 'RESTRICT')}</select></td>
        <td><select data-field="rel-on-update">${cardOpts(actions, conn.onUpdateAction || 'RESTRICT')}</select></td>
      </tr>`;
    })
    .filter(Boolean)
    .join('');
  return `
    <table class="grid">
      <thead><tr><th>FK</th><th>Name</th><th>Parent</th><th>Child</th><th>On delete</th><th>On update</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" class="hint-row">This table does not reference others. Use the Relation tool.</td></tr>'}</tbody>
    </table>`;
}

function viewBody(v: ErmView): string {
  const ownColumns = v.columns
    .filter((i): i is { kind: 'column'; column: ErmColumn } => i.kind === 'column')
    .map((i) => i.column);
  const rows = expandedColumns(v)
    .map((c) => {
      const own = ownColumns.includes(c);
      const dis = own ? '' : ' disabled';
      return `<tr data-vcol="${ownColumns.indexOf(c)}">
        <td><input type="text" data-field="vc-name" value="${esc(columnName(c))}"${dis}></td>
        <td><input type="text" data-field="vc-type" value="${esc(formatType(c))}" list="type-list"${dis}></td>
        <td class="center"><button class="icon-btn" data-action="vcol-del" title="Delete"${own ? '' : ' disabled'}>✕</button></td>
      </tr>`;
    })
    .join('');
  return `
    <div class="field"><label>Physical name</label><input type="text" data-field="v-physical" value="${esc(v.physicalName)}"></div>
    <div class="field"><label>Logical name</label><input type="text" data-field="v-logical" value="${esc(v.logicalName)}"></div>
    <div class="field"><label>SQL</label><textarea rows="6" data-field="v-sql">${esc(v.sql)}</textarea></div>
    <div class="field"><label>Columns</label>
      <div class="grid-toolbar"><button data-action="add-vcol">+ Column</button></div>
      <table class="grid">
        <thead><tr><th>Name</th><th>Type</th><th></th></tr></thead>
        <tbody>${rows || '<tr><td colspan="3" class="hint-row">No columns.</td></tr>'}</tbody>
      </table>
      ${TYPE_DATALIST}
    </div>`;
}

function imageBody(img: ErmImage): string {
  const mime = img.data.startsWith('/9j/')
    ? 'image/jpeg'
    : img.data.startsWith('R0lGOD')
      ? 'image/gif'
      : img.data.startsWith('Qk')
        ? 'image/bmp'
        : img.data.startsWith('PHN2Zy') || img.data.startsWith('PD94bWw')
          ? 'image/svg+xml'
          : 'image/png';
  const preview = img.data
    ? `<img src="data:${mime};base64,${img.data}" style="max-width:100%;max-height:160px;display:block;margin-bottom:10px;border:1px solid var(--vscode-panel-border,#3c3c3c)">`
    : '';
  const slider = (field: string, label: string, min: number, max: number, value: string) =>
    `<div class="field row"><label>${label}</label>
      <input type="range" data-field="${field}" min="${min}" max="${max}" value="${esc(value)}">
      <input type="number" data-field="${field}" min="${min}" max="${max}" value="${esc(value)}" style="width:64px">
    </div>`;
  return `
    ${preview}
    ${slider('img-hue', 'Hue', 0, 360, img.hue)}
    ${slider('img-saturation', 'Saturation', -100, 100, img.saturation)}
    ${slider('img-brightness', 'Brightness', -100, 100, img.brightness)}
    ${slider('img-alpha', 'Opacity', 0, 255, img.alpha)}
    <div class="field row"><label>Keep aspect ratio</label>
      <input type="checkbox" data-field="img-aspect"${img.fixAspectRatio === 'true' ? ' checked' : ''}></div>`;
}

function noteBody(n: ErmNote): string {
  return `
    <div class="field"><label>Text</label><textarea rows="8" data-field="note-text">${esc(n.text)}</textarea></div>
    <div class="field row"><label>Color</label><input type="color" data-field="note-color" value="${rgbToHex(n.base.color)}"></div>`;
}

// ------------------------------------------------------------ events

root.addEventListener('click', (e) => {
  if (!current) {
    return;
  }
  const target = e.target as HTMLElement;
  if (target.hasAttribute('data-overlay')) {
    closeDialog();
    return;
  }
  const tab = target.closest('.tab') as HTMLElement | null;
  if (tab && tab.dataset.tab) {
    current.tab = tab.dataset.tab;
    renderDialog();
    return;
  }
  const btn = target.closest('button') as HTMLButtonElement | null;
  if (!btn || btn.disabled) {
    return;
  }
  handleAction(btn);
});

root.addEventListener('change', (e) => {
  if (!current || !app.doc) {
    return;
  }
  const el = e.target as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
  handleChange(el);
});

function handleAction(btn: HTMLButtonElement): void {
  if (!current || !app.doc) {
    return;
  }
  const action = btn.dataset.action;

  if (action === 'close') {
    closeDialog();
    return;
  }

  // categories dialog
  if (current.categories) {
    if (action === 'add-cat') {
      addCategory(app.doc);
      commit();
    } else if (action === 'cat-del') {
      const cat = app.doc.settings.categories[parseInt(btn.dataset.cat ?? '-1', 10)];
      if (cat) {
        deleteCategory(app.doc, cat);
        commit();
      }
    }
    return;
  }

  const node = current.node;
  if (!node) {
    return;
  }
  if (action === 'delete-node') {
    deleteNode(app.doc, node);
    app.selectedIndex = -1;
    closeDialog();
    commit();
    return;
  }

  // view column editing
  if (node.kind === 'view') {
    if (action === 'add-vcol') {
      addViewColumn(node, `COLUMN_${expandedColumns(node).length + 1}`, 'varchar(255)');
      commit();
    } else if (action === 'vcol-del') {
      const vtr = btn.closest('tr') as HTMLElement | null;
      const own = node.columns.filter((i) => i.kind === 'column');
      const item = own[parseInt(vtr?.dataset.vcol ?? '-1', 10)];
      if (item && item.kind === 'column') {
        deleteViewColumn(node, item.column);
        commit();
      }
    }
    return;
  }

  if (node.kind !== 'table') {
    return;
  }
  const t = node;

  if (action === 'add-col') {
    addColumn(t, `COLUMN_${expandedColumns(t).length + 1}`, 'varchar(255)');
    commit();
    return;
  }
  if (action === 'add-idx') {
    addIndex(t);
    commit();
    return;
  }
  if (action === 'add-cuk') {
    addComplexUniqueKey(t);
    commit();
    return;
  }
  if (action === 'td-add-row') {
    const td = ensureTableTestData(ensureTestData(app.doc), t);
    addDirectRow(t, td);
    commit();
    return;
  }
  if (action === 'td-del-row') {
    const tr = btn.closest('tr') as HTMLElement | null;
    const td = app.doc.testDataList[0]?.tables.find((x) => x.table === t);
    if (td && tr) {
      deleteDirectRow(td, parseInt(tr.dataset.tdRow ?? '-1', 10));
      commit();
    }
    return;
  }

  // column groups (diagram-wide)
  if (action === 'add-group') {
    const group = addColumnGroup(app.doc, `GROUP_${app.doc.columnGroups.length + 1}`);
    toggleTableGroup(t, group); // attach the new group to the current table by default
    commit();
    return;
  }
  if (action === 'group-add-col' || action === 'group-del') {
    const group = app.doc.columnGroups[parseInt(btn.dataset.group ?? '-1', 10)];
    if (group) {
      if (action === 'group-add-col') {
        addColumnToGroup(group, `COLUMN_${group.columns.length + 1}`, 'varchar(255)');
      } else {
        deleteColumnGroup(app.doc, group);
      }
      commit();
    }
    return;
  }

  const tr = btn.closest('tr') as HTMLElement | null;
  if (!tr) {
    return;
  }
  if (action === 'group-col-del') {
    const group = app.doc.columnGroups[parseInt(tr.dataset.group ?? '-1', 10)];
    const col = group?.columns[parseInt(tr.dataset.gcol ?? '-1', 10)];
    if (group && col) {
      removeColumnFromGroup(group, col);
      commit();
    }
    return;
  }
  if (action === 'col-del') {
    const col = expandedColumns(t)[parseInt(tr.dataset.col ?? '-1', 10)];
    if (col) {
      deleteColumn(app.doc, t, col);
      commit();
    }
  } else if (action === 'col-up' || action === 'col-down') {
    const ownIndex = parseInt(tr.dataset.own ?? '-1', 10);
    if (ownIndex >= 0) {
      moveColumnItem(t, ownIndex, action === 'col-up' ? -1 : 1);
      commit();
    }
  } else if (action === 'idx-del') {
    t.indexes.splice(parseInt(tr.dataset.idx ?? '-1', 10), 1);
    commit();
  } else if (action === 'cuk-del') {
    const cuk = t.complexUniqueKeys[parseInt(tr.dataset.cuk ?? '-1', 10)];
    if (cuk) {
      deleteComplexUniqueKey(app.doc, t, cuk);
      commit();
    }
  }
}

function handleChange(el: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement): void {
  if (!current || !app.doc) {
    return;
  }
  const field = el.dataset.field;

  // categories dialog
  if (current.categories) {
    if (el.dataset.cat === undefined) {
      return;
    }
    const cat = app.doc.settings.categories[parseInt(el.dataset.cat, 10)];
    if (!cat) {
      return;
    }
    if (field === 'cat-name') {
      cat.name = (el as HTMLInputElement).value;
    } else if (field === 'cat-color') {
      cat.base.color = hexToRgb(el.value);
    } else if (el.dataset.catNode !== undefined) {
      const target = app.doc.contents[parseInt(el.dataset.catNode, 10)];
      if (target) {
        toggleCategoryNode(cat, target);
      }
    }
    commit();
    return;
  }

  const node = current.node;
  if (!node) {
    return;
  }

  // note / view fields
  if (node.kind === 'note' && field === 'note-text') {
    node.text = (el as HTMLTextAreaElement).value;
    commit();
    return;
  }
  if (node.kind === 'note' && field === 'note-color') {
    node.base.color = hexToRgb(el.value);
    commit();
    return;
  }
  if (node.kind === 'view') {
    const vtr = el.closest('tr') as HTMLElement | null;
    if (vtr && vtr.dataset.vcol !== undefined) {
      const own = node.columns.filter((i) => i.kind === 'column');
      const item = own[parseInt(vtr.dataset.vcol, 10)];
      if (item && item.kind === 'column') {
        if (field === 'vc-name') {
          const v = (el as HTMLInputElement).value.trim();
          if (v) setColumnName(item.column, v);
        } else if (field === 'vc-type') {
          setColumnType(item.column, (el as HTMLInputElement).value.trim());
        }
        commit();
      }
      return;
    }
    if (field === 'v-physical') {
      node.physicalName = el.value.trim();
    } else if (field === 'v-logical') {
      node.logicalName = el.value.trim();
    } else if (field === 'v-sql') {
      node.sql = (el as HTMLTextAreaElement).value;
    }
    commit();
    return;
  }
  if (node.kind === 'image') {
    if (field === 'img-hue') node.hue = clampInt(el.value, 0, 360);
    else if (field === 'img-saturation') node.saturation = clampInt(el.value, -100, 100);
    else if (field === 'img-brightness') node.brightness = clampInt(el.value, -100, 100);
    else if (field === 'img-alpha') node.alpha = clampInt(el.value, 0, 255);
    else if (field === 'img-aspect') node.fixAspectRatio = (el as HTMLInputElement).checked ? 'true' : 'false';
    commit();
    return;
  }
  if (node.kind !== 'table') {
    return;
  }
  const t = node;

  // table attributes
  if (field === 'physicalName') {
    t.physicalName = el.value.trim();
    commit();
    return;
  }
  if (field === 'logicalName' && el.closest('.field')) {
    t.logicalName = el.value.trim();
    commit();
    return;
  }
  if (field === 'description') {
    t.description = (el as HTMLTextAreaElement).value;
    commit();
    return;
  }
  if (field === 'color') {
    t.base.color = hexToRgb(el.value);
    commit();
    return;
  }

  // column groups
  if (field === 'group-attach' && el.dataset.group !== undefined) {
    const group = app.doc.columnGroups[parseInt(el.dataset.group, 10)];
    if (group) {
      toggleTableGroup(t, group);
      commit();
    }
    return;
  }
  if (field === 'group-name' && el.dataset.group !== undefined) {
    const group = app.doc.columnGroups[parseInt(el.dataset.group, 10)];
    if (group) {
      group.groupName = (el as HTMLInputElement).value;
      commit();
    }
    return;
  }
  {
    const gtr = el.closest('tr') as HTMLElement | null;
    if (gtr && gtr.dataset.gcol !== undefined && gtr.dataset.group !== undefined) {
      const group = app.doc.columnGroups[parseInt(gtr.dataset.group, 10)];
      const gcol = group?.columns[parseInt(gtr.dataset.gcol, 10)];
      if (group && gcol) {
        if (field === 'g-name') {
          const v = (el as HTMLInputElement).value.trim();
          if (v) setColumnName(gcol, v);
        } else if (field === 'g-type') {
          setColumnType(gcol, (el as HTMLInputElement).value.trim());
        } else if (field === 'g-nn') {
          gcol.notNull = (el as HTMLInputElement).checked ? 'true' : 'false';
        }
        commit();
      }
      return;
    }
  }

  const columns = expandedColumns(t);

  // test-data direct cell
  if (field === 'td-cell' && el.dataset.tdRow !== undefined && el.dataset.tdCol !== undefined) {
    const td = app.doc.testDataList[0]?.tables.find((x) => x.table === t);
    const col = columns[parseInt(el.dataset.tdCol, 10)];
    if (td && col) {
      setDirectCell(td, parseInt(el.dataset.tdRow, 10), col, (el as HTMLInputElement).value);
      commit();
    }
    return;
  }

  // index
  const tr = el.closest('tr') as HTMLElement | null;
  if (tr && tr.dataset.idx !== undefined && field?.startsWith('idx')) {
    const idx = t.indexes[parseInt(tr.dataset.idx, 10)];
    if (!idx) return;
    if (field === 'idx-name') {
      idx.name = (el as HTMLInputElement).value.trim();
    } else if (field === 'idx-unique') {
      idx.nonUnique = (el as HTMLInputElement).checked ? 'false' : 'true';
    }
    commit();
    return;
  }
  if (el.dataset.idxCol !== undefined && el.dataset.idx !== undefined) {
    const idx = t.indexes[parseInt(el.dataset.idx, 10)];
    const col = columns[parseInt(el.dataset.idxCol, 10)];
    if (idx && col) {
      toggleIndexColumn(idx, col);
      commit();
    }
    return;
  }

  // unique key
  if (tr && tr.dataset.cuk !== undefined && field === 'cuk-name') {
    const cuk = t.complexUniqueKeys[parseInt(tr.dataset.cuk, 10)];
    if (cuk) {
      cuk.name = (el as HTMLInputElement).value.trim();
      commit();
    }
    return;
  }
  if (el.dataset.cukCol !== undefined && el.dataset.cuk !== undefined) {
    const cuk = t.complexUniqueKeys[parseInt(el.dataset.cuk, 10)];
    const col = columns[parseInt(el.dataset.cukCol, 10)];
    if (cuk && col) {
      toggleCukColumn(cuk, col);
      commit();
    }
    return;
  }

  // relation
  if (tr && tr.dataset.rel !== undefined && field?.startsWith('rel')) {
    const conn = t.base.incomings[parseInt(tr.dataset.rel, 10)];
    if (!conn || conn.kind !== 'relation') return;
    switch (field) {
      case 'rel-name':
        conn.name = (el as HTMLInputElement).value.trim();
        break;
      case 'rel-parent-card':
        conn.parentCardinality = el.value;
        break;
      case 'rel-child-card':
        conn.childCardinality = el.value;
        break;
      case 'rel-on-delete':
        conn.onDeleteAction = el.value;
        break;
      case 'rel-on-update':
        conn.onUpdateAction = el.value;
        break;
    }
    commit();
    return;
  }

  // column grid
  if (tr && tr.dataset.col !== undefined) {
    const col = columns[parseInt(tr.dataset.col, 10)];
    if (!col) return;
    const isFk = col.referencedColumns.length > 0;
    switch (field) {
      case 'name': {
        const v = (el as HTMLInputElement).value.trim();
        if (v) setColumnName(col, v);
        break;
      }
      case 'logicalName':
        if (isFk) {
          col.logicalName = (el as HTMLInputElement).value.trim();
        } else if (col.word) {
          col.word.logicalName = (el as HTMLInputElement).value.trim();
        }
        break;
      case 'type':
        setColumnType(col, (el as HTMLInputElement).value.trim());
        break;
      case 'primaryKey':
        col.primaryKey = (el as HTMLInputElement).checked ? 'true' : 'false';
        if (col.primaryKey === 'true') col.notNull = 'true';
        break;
      case 'notNull':
        col.notNull = (el as HTMLInputElement).checked ? 'true' : 'false';
        break;
      case 'uniqueKey':
        col.uniqueKey = (el as HTMLInputElement).checked ? 'true' : 'false';
        break;
      case 'defaultValue':
        col.defaultValue = (el as HTMLInputElement).value.trim();
        break;
      case 'fk': {
        const value = (el as HTMLSelectElement).value;
        for (const rel of [...col.relations]) {
          removeRelation(app.doc, rel);
        }
        if (value) {
          const [ti, pci] = value.split(':').map((v) => parseInt(v, 10));
          const parent = app.doc.contents[ti];
          if (parent && parent.kind === 'table') {
            const parentCol = expandedColumns(parent)[pci];
            if (parentCol) {
              createRelation(app.doc, t, col, parent, parentCol);
            }
          }
        }
        break;
      }
    }
    commit();
  }
}
