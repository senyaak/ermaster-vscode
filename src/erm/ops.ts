import {
  ErmCategory,
  ErmColumn,
  ErmColumnGroup,
  ErmCommentConnection,
  ErmComplexUniqueKey,
  ErmDiagram,
  ErmImage,
  ErmIndex,
  ErmNode,
  ErmNote,
  ErmRelation,
  ErmTable,
  ErmTableTestData,
  ErmTestData,
  ErmView,
  ErmWord,
  expandedColumns,
} from './model';

/**
 * Editing operations on the .erm model, mirroring what ERMaster's commands do.
 * Shared between the webview editor and the extension host.
 */

// ------------------------------------------------------------ new diagram

export function emptyDiagram(database = 'PostgreSQL'): ErmDiagram {
  return {
    dbsetting: null,
    pageSetting: null,
    categoryIndex: '0',
    zoom: '1.0',
    x: '0',
    y: '0',
    defaultColor: { r: '128', g: '128', b: '192' },
    color: { r: '255', g: '255', b: '255' },
    fontName: '',
    fontSize: '9',
    settings: {
      database,
      capital: 'false',
      tableStyle: '',
      notation: 'IE',
      notationLevel: '0',
      notationExpandGroup: 'true',
      viewMode: '1',
      outlineViewMode: '1',
      viewOrderBy: '1',
      autoImeChange: 'false',
      validatePhysicalName: 'true',
      useBezierCurve: 'false',
      suspendValidator: 'false',
      exportDdl: null,
      exportExcel: null,
      exportHtml: null,
      exportImage: null,
      exportJava: null,
      exportTestData: null,
      categoryFreeLayout: 'false',
      categoryShowReferredTables: 'false',
      categories: [],
      translationSettings: null,
      modelProperties: null,
      tableProperties: null,
      environments: [{ name: 'Default' }],
    },
    words: [],
    tablespaces: [],
    contents: [],
    columnGroups: [],
    testDataList: [],
    sequences: [],
    triggers: [],
    changeTrackings: [],
  };
}

// ------------------------------------------------------------ tables

export function addTable(diagram: ErmDiagram, x: number, y: number): ErmTable {
  const n = diagram.contents.filter((c) => c.kind === 'table').length + 1;
  const idColumn = newColumn('id', 'serial');
  idColumn.primaryKey = 'true';
  idColumn.notNull = 'true';

  const table: ErmTable = {
    kind: 'table',
    base: {
      height: '-1',
      width: '-1',
      fontName: '',
      fontSize: '9',
      x: String(Math.round(x)),
      y: String(Math.round(y)),
      color: { ...diagram.defaultColor },
      incomings: [],
    },
    physicalName: `TABLE_${n}`,
    logicalName: `TABLE_${n}`,
    description: '',
    constraint: '',
    primaryKeyName: '',
    option: '',
    columns: [{ kind: 'column', column: idColumn }],
    indexes: [],
    complexUniqueKeys: [],
    tableProperties: null,
  };
  diagram.contents.push(table);
  return table;
}

export function deleteTable(diagram: ErmDiagram, table: ErmTable): void {
  deleteNode(diagram, table);
}

/** Delete any node (table, view, note, image) with connection cleanup. */
export function deleteNode(diagram: ErmDiagram, node: ErmNode): void {
  // connections targeting the node die with it; connections *from* it live
  // in other nodes' incomings and must be removed (FK columns released)
  for (const other of diagram.contents) {
    if (other === node) {
      continue;
    }
    for (const conn of [...other.base.incomings]) {
      if (conn.source === node) {
        if (conn.kind === 'relation') {
          removeRelation(diagram, conn);
        } else {
          other.base.incomings = other.base.incomings.filter((c) => c !== conn);
        }
      }
    }
  }
  diagram.contents = diagram.contents.filter((c) => c !== node);
  for (const category of diagram.settings.categories) {
    category.contents = category.contents.filter((c) => c !== node);
  }
}

// ------------------------------------------------------------ notes

export function addNote(diagram: ErmDiagram, x: number, y: number, text = ''): ErmNote {
  const note: ErmNote = {
    kind: 'note',
    base: {
      height: '100',
      width: '160',
      fontName: '',
      fontSize: '9',
      x: String(Math.round(x)),
      y: String(Math.round(y)),
      color: { r: '255', g: '255', b: '206' },
      incomings: [],
    },
    text,
  };
  diagram.contents.push(note);
  return note;
}

/** Insert a base64-encoded image (raw bytes, like ERMaster's InsertedImage). */
export function addImage(
  diagram: ErmDiagram,
  x: number,
  y: number,
  base64: string,
  width: number,
  height: number,
): ErmImage {
  const image: ErmImage = {
    kind: 'image',
    base: {
      height: String(Math.max(1, Math.round(height))),
      width: String(Math.max(1, Math.round(width))),
      fontName: '',
      fontSize: '9',
      x: String(Math.round(x)),
      y: String(Math.round(y)),
      color: null,
      incomings: [],
    },
    data: base64,
    hue: '0',
    saturation: '0',
    brightness: '0',
    alpha: '255',
    fixAspectRatio: 'true',
  };
  diagram.contents.push(image);
  return image;
}

// ------------------------------------------------------------ indexes

export function addIndex(table: ErmTable): ErmIndex {
  const index: ErmIndex = {
    fullText: 'false',
    nonUnique: 'true',
    name: `idx_${table.physicalName}_${table.indexes.length + 1}`.toLowerCase(),
    type: '',
    description: '',
    columns: [],
  };
  table.indexes.push(index);
  return index;
}

export function toggleIndexColumn(index: ErmIndex, column: ErmColumn): void {
  const existing = index.columns.find((c) => c.column === column);
  if (existing) {
    index.columns = index.columns.filter((c) => c !== existing);
  } else {
    index.columns.push({ column, desc: 'false' });
  }
}

// ------------------------------------------------------------ complex unique keys

export function addComplexUniqueKey(table: ErmTable): ErmComplexUniqueKey {
  const cuk: ErmComplexUniqueKey = { name: '', columns: [] };
  table.complexUniqueKeys.push(cuk);
  return cuk;
}

export function toggleCukColumn(cuk: ErmComplexUniqueKey, column: ErmColumn): void {
  if (cuk.columns.includes(column)) {
    cuk.columns = cuk.columns.filter((c) => c !== column);
  } else {
    cuk.columns.push(column);
  }
}

/** Delete a complex unique key, dropping relations that reference it. */
export function deleteComplexUniqueKey(
  diagram: ErmDiagram,
  table: ErmTable,
  cuk: ErmComplexUniqueKey,
): void {
  for (const node of diagram.contents) {
    if (node.kind !== 'table' && node.kind !== 'view') {
      continue;
    }
    for (const conn of [...node.base.incomings]) {
      if (conn.kind === 'relation' && conn.referencedComplexUniqueKey === cuk) {
        removeRelation(diagram, conn);
      }
    }
  }
  table.complexUniqueKeys = table.complexUniqueKeys.filter((c) => c !== cuk);
}

// ------------------------------------------------------------ colors

export function rgbToHex(color: { r: string; g: string; b: string } | null): string {
  if (!color) {
    return '#ffffff';
  }
  const part = (v: string) => Math.max(0, Math.min(255, parseInt(v, 10) || 0)).toString(16).padStart(2, '0');
  return `#${part(color.r)}${part(color.g)}${part(color.b)}`;
}

export function hexToRgb(hex: string): { r: string; g: string; b: string } {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex.trim());
  if (!m) {
    return { r: '255', g: '255', b: '255' };
  }
  return {
    r: String(parseInt(m[1], 16)),
    g: String(parseInt(m[2], 16)),
    b: String(parseInt(m[3], 16)),
  };
}

// ------------------------------------------------------------ categories

export function addCategory(diagram: ErmDiagram, name = `Category ${diagram.settings.categories.length + 1}`): ErmCategory {
  const category: ErmCategory = {
    base: {
      height: '-1',
      width: '-1',
      fontName: '',
      fontSize: '9',
      x: '0',
      y: '0',
      color: { r: '181', g: '196', b: '223' },
      incomings: [],
    },
    name,
    selected: 'false',
    contents: [],
  };
  diagram.settings.categories.push(category);
  return category;
}

export function deleteCategory(diagram: ErmDiagram, category: ErmCategory): void {
  diagram.settings.categories = diagram.settings.categories.filter((c) => c !== category);
}

export function toggleCategoryNode(category: ErmCategory, node: ErmNode): void {
  if (category.contents.includes(node)) {
    category.contents = category.contents.filter((n) => n !== node);
  } else {
    category.contents.push(node);
  }
}

/** ERMaster database dialect ids (DBManagerFactory registration order). */
export const DATABASE_IDS = [
  'DB2',
  'H2',
  'HSQLDB',
  'MSAccess',
  'MySQL',
  'Oracle',
  'PostgreSQL',
  'SQLite',
  'SQLServer',
  'SQLServer 2008',
  'StandardSQL',
];

// ------------------------------------------------------------ columns

let wordSeq = 0;

function newWord(physicalName: string, type: string): ErmWord {
  wordSeq++;
  const { typeId, length, decimal } = parseTypeInput(type);
  return {
    length,
    decimal,
    array: 'false',
    arrayDimension: 'null',
    unsigned: 'false',
    zerofill: 'false',
    binary: 'false',
    args: '',
    charSemantics: 'false',
    description: '',
    logicalName: physicalName,
    physicalName,
    type: typeId,
  };
}

export function newColumn(physicalName: string, type: string): ErmColumn {
  // like ERMaster: a plain column's name lives in its word; the column's own
  // physical_name/logical_name fields are only FK-name overrides
  const word = newWord(physicalName, type);
  return {
    word,
    relations: [],
    referencedColumns: [],
    description: '',
    uniqueKeyName: '',
    logicalName: '',
    physicalName: '',
    type: word.type,
    constraint: '',
    defaultValue: '',
    autoIncrement: 'false',
    foreignKey: 'false',
    notNull: 'false',
    primaryKey: 'false',
    uniqueKey: 'false',
    characterSet: '',
    collation: '',
    sequence: null,
  };
}

export function addColumn(table: ErmTable, physicalName: string, type: string): ErmColumn {
  const column = newColumn(physicalName, type);
  table.columns.push({ kind: 'column', column });
  autoSize(table);
  return column;
}

/** Add a plain column to a view (views have no PK/FK, so this is simpler). */
export function addViewColumn(view: ErmView, physicalName: string, type: string): ErmColumn {
  const column = newColumn(physicalName, type);
  view.columns.push({ kind: 'column', column });
  return column;
}

/** Remove a column from a view. */
export function deleteViewColumn(view: ErmView, column: ErmColumn): void {
  view.columns = view.columns.filter((i) => i.kind !== 'column' || i.column !== column);
}

export function deleteColumn(diagram: ErmDiagram, table: ErmTable, column: ErmColumn): void {
  // drop relations that reference this column from child tables
  for (const node of diagram.contents) {
    if (node.kind !== 'table') {
      continue;
    }
    for (const conn of [...node.base.incomings]) {
      if (conn.kind !== 'relation') {
        continue;
      }
      const referencesColumn =
        conn.referencedColumn === column ||
        (conn.referenceForPk === 'true' &&
          conn.source === table &&
          column.primaryKey === 'true') ||
        expandedColumns(node).some(
          (c) => c.relations.includes(conn) && c.referencedColumns.includes(column),
        );
      if (referencesColumn) {
        removeRelation(diagram, conn);
      }
    }
  }
  // drop relations this column participates in as FK
  for (const rel of [...column.relations]) {
    removeRelation(diagram, rel);
  }
  table.columns = table.columns.filter((i) => i.kind !== 'column' || i.column !== column);
  for (const index of table.indexes) {
    index.columns = index.columns.filter((c) => c.column !== column);
  }
  table.indexes = table.indexes.filter((i) => i.columns.length > 0);
  for (const cuk of table.complexUniqueKeys) {
    cuk.columns = cuk.columns.filter((c) => c !== column);
  }
  table.complexUniqueKeys = table.complexUniqueKeys.filter((c) => c.columns.length > 0);
  autoSize(table);
}

/** Let ERMaster (GEF) auto-size the node after structural changes. */
function autoSize(table: ErmTable): void {
  table.base.height = '-1';
}

// ------------------------------------------------------------ relations

/**
 * Create a relation using an existing child column as the FK
 * (ERMaster's "relation by existing columns").
 */
export function createRelation(
  diagram: ErmDiagram,
  childTable: ErmTable,
  childColumn: ErmColumn,
  parentTable: ErmTable,
  parentColumn: ErmColumn,
): ErmRelation {
  // one FK relation per column in this editor
  for (const rel of [...childColumn.relations]) {
    removeRelation(diagram, rel);
  }

  const singlePk =
    parentColumn.primaryKey === 'true' &&
    expandedColumns(parentTable).filter((c) => c.primaryKey === 'true').length === 1;

  const relation: ErmRelation = {
    kind: 'relation',
    source: parentTable,
    target: childTable,
    sourceXp: '-1',
    sourceYp: '-1',
    targetXp: '-1',
    targetYp: '-1',
    bendpoints: [],
    color: { r: '0', g: '0', b: '0' },
    childCardinality: '1..n',
    parentCardinality: '1',
    referenceForPk: singlePk ? 'true' : 'false',
    name: '',
    onDeleteAction: 'RESTRICT',
    onUpdateAction: 'RESTRICT',
    referencedColumn: singlePk ? null : parentColumn,
    referencedComplexUniqueKey: null,
  };

  // like NormalColumn.addReference(): keep current names as FK overrides,
  // then drop the own word — the type now comes from the referenced column
  const physicalName = columnName(childColumn);
  const logicalName = childColumn.logicalName || childColumn.word?.logicalName || '';

  childTable.base.incomings.push(relation);
  childColumn.relations.push(relation);
  childColumn.referencedColumns.push(parentColumn);
  childColumn.foreignKey = 'true';
  childColumn.physicalName = physicalName;
  childColumn.logicalName = logicalName;
  childColumn.word = null;
  return relation;
}

/**
 * ERMaster's palette "Relation (1:n)" tool: creates the relation AND the FK
 * columns in the child table by copying the parent's primary keys (the FK
 * columns share the parent columns' words, like NormalColumn(from) does).
 */
export function createRelationAutoFk(
  parentTable: ErmTable,
  childTable: ErmTable,
): ErmRelation | null {
  const pks = expandedColumns(parentTable).filter((c) => c.primaryKey === 'true');
  if (pks.length === 0) {
    return null;
  }
  const relation: ErmRelation = {
    kind: 'relation',
    source: parentTable,
    target: childTable,
    sourceXp: '-1',
    sourceYp: '-1',
    targetXp: '-1',
    targetYp: '-1',
    bendpoints: [],
    color: { r: '0', g: '0', b: '0' },
    childCardinality: '1..n',
    parentCardinality: '1',
    referenceForPk: 'true',
    name: '',
    onDeleteAction: 'RESTRICT',
    onUpdateAction: 'RESTRICT',
    referencedColumn: null,
    referencedComplexUniqueKey: null,
  };
  childTable.base.incomings.push(relation);
  for (const pk of pks) {
    const fk: ErmColumn = {
      word: pk.word, // shared word — name/type follow the parent
      relations: [relation],
      referencedColumns: [pk],
      description: '',
      uniqueKeyName: '',
      logicalName: '',
      physicalName: '',
      type: pk.type,
      constraint: '',
      defaultValue: '',
      autoIncrement: 'false',
      foreignKey: 'true',
      notNull: 'true',
      primaryKey: 'false',
      uniqueKey: 'false',
      characterSet: '',
      collation: '',
      sequence: null,
    };
    childTable.columns.push({ kind: 'column', column: fk });
  }
  childTable.base.height = '-1';
  return relation;
}

/** Move an own column up/down within the table's column list. */
export function moveColumnItem(table: ErmTable, index: number, delta: -1 | 1): void {
  const target = index + delta;
  if (index < 0 || index >= table.columns.length || target < 0 || target >= table.columns.length) {
    return;
  }
  const items = [...table.columns];
  [items[index], items[target]] = [items[target], items[index]];
  table.columns = items;
}

export type ViewMode = 'logical' | 'physical' | 'both';

export function viewModeOf(diagram: ErmDiagram): ViewMode {
  switch (diagram.settings.viewMode) {
    case '0':
      return 'logical';
    case '2':
      return 'both';
    default:
      return 'physical';
  }
}

export function setViewMode(diagram: ErmDiagram, mode: ViewMode): void {
  diagram.settings.viewMode = mode === 'logical' ? '0' : mode === 'both' ? '2' : '1';
}

/** Table caption per view mode, like ERMaster's TableFigure. */
export function tableDisplayName(
  t: { physicalName: string; logicalName: string },
  mode: ViewMode,
): string {
  const physical = t.physicalName || t.logicalName;
  const logical = t.logicalName || t.physicalName;
  if (mode === 'logical') {
    return logical;
  }
  if (mode === 'both') {
    return logical === physical ? physical : `${logical} / ${physical}`;
  }
  return physical;
}

/** Column logical name (word for plain columns, override for FK). */
export function columnLogicalName(column: ErmColumn): string {
  const parent = column.referencedColumns[0] ?? null;
  if (parent) {
    return column.logicalName || columnLogicalName(parent);
  }
  return column.word?.logicalName || column.logicalName || '';
}

export function columnDisplayName(column: ErmColumn, mode: ViewMode): string {
  const physical = columnName(column);
  const logical = columnLogicalName(column) || physical;
  if (mode === 'logical') {
    return logical;
  }
  if (mode === 'both') {
    return logical === physical ? physical : `${logical} / ${physical}`;
  }
  return physical;
}

export function removeRelation(diagram: ErmDiagram, relation: ErmRelation): void {
  const target = relation.target;
  if (target && (target.kind === 'table' || target.kind === 'view')) {
    target.base.incomings = target.base.incomings.filter((c) => c !== relation);
    for (const column of expandedColumns(target)) {
      if (!column.relations.includes(relation)) {
        continue;
      }
      column.relations = column.relations.filter((r) => r !== relation);
      if (column.relations.length === 0) {
        // release the FK column: it becomes a plain column with its own word
        const parent = column.referencedColumns[0];
        column.referencedColumns = [];
        column.foreignKey = 'false';
        const template = column.word ?? parent?.word ?? null;
        column.word = template
          ? { ...template, physicalName: column.physicalName || template.physicalName, logicalName: column.logicalName || template.logicalName }
          : newWord(column.physicalName, column.type);
      } else {
        column.referencedColumns = column.referencedColumns.filter(
          (c) => relation.source !== findOwner(diagram, c),
        );
      }
    }
  }
}

function findOwner(diagram: ErmDiagram, column: ErmColumn): ErmTable | null {
  for (const node of diagram.contents) {
    if (node.kind === 'table' && expandedColumns(node).includes(column)) {
      return node;
    }
  }
  return null;
}

/** The relation shown for a column in the editor (first FK relation). */
export function columnRelation(column: ErmColumn): ErmRelation | null {
  return column.relations[0] ?? null;
}

// ------------------------------------------------------------ test data

/** The first test-data set, creating a default one if none exists. */
export function ensureTestData(diagram: ErmDiagram): ErmTestData {
  if (diagram.testDataList.length === 0) {
    diagram.testDataList.push({ name: 'TEST_DATA', exportOrder: '0', tables: [] });
  }
  return diagram.testDataList[0];
}

/** The per-table test data within a set, creating it if missing. */
export function ensureTableTestData(set: ErmTestData, table: ErmTable): ErmTableTestData {
  let td = set.tables.find((t) => t.table === table);
  if (!td) {
    td = { table, directRows: [], repeatTestDataNum: '0', repeatDefs: [] };
    set.tables.push(td);
  }
  return td;
}

/** Append an empty direct row (one blank cell per current column). */
export function addDirectRow(table: ErmTable, td: ErmTableTestData): void {
  td.directRows.push(expandedColumns(table).map((c) => ({ column: c, value: '' })));
}

export function deleteDirectRow(td: ErmTableTestData, rowIndex: number): void {
  if (rowIndex >= 0 && rowIndex < td.directRows.length) {
    td.directRows.splice(rowIndex, 1);
  }
}

/** Set a cell value in a direct row, adding the column cell if absent. */
export function setDirectCell(
  td: ErmTableTestData,
  rowIndex: number,
  column: ErmColumn,
  value: string,
): void {
  const row = td.directRows[rowIndex];
  if (!row) {
    return;
  }
  const cell = row.find((c) => c.column === column);
  if (cell) {
    cell.value = value;
  } else {
    row.push({ column, value });
  }
}

/** Remove empty per-table test data / empty sets so nothing dangles on save. */
export function pruneTestData(diagram: ErmDiagram): void {
  for (const set of diagram.testDataList) {
    set.tables = set.tables.filter(
      (t) => t.directRows.length > 0 || (parseInt(t.repeatTestDataNum, 10) || 0) > 0,
    );
  }
  diagram.testDataList = diagram.testDataList.filter((s) => s.tables.length > 0);
}

// ------------------------------------------------------------ comment connections

/**
 * Link a note to a table/view (ERMaster's comment_connection). One endpoint
 * must be a note. The connection is stored in the target's incomings, like
 * ERMaster serializes it. Returns null if neither endpoint is a note.
 */
export function createCommentConnection(
  source: ErmNode,
  target: ErmNode,
): ErmCommentConnection | null {
  if (source === target || (source.kind !== 'note' && target.kind !== 'note')) {
    return null;
  }
  const conn: ErmCommentConnection = {
    kind: 'comment',
    source,
    target,
    sourceXp: '-1',
    sourceYp: '-1',
    targetXp: '-1',
    targetYp: '-1',
    bendpoints: [],
    color: null,
  };
  target.base.incomings.push(conn);
  return conn;
}

/** All comment connections in the diagram, in a stable (contents) order. */
export function allCommentConnections(diagram: ErmDiagram): ErmCommentConnection[] {
  const out: ErmCommentConnection[] = [];
  for (const node of diagram.contents) {
    for (const conn of node.base.incomings) {
      if (conn.kind === 'comment') {
        out.push(conn);
      }
    }
  }
  return out;
}

/** Remove a comment connection from wherever it is stored. */
export function removeCommentConnection(diagram: ErmDiagram, conn: ErmCommentConnection): void {
  for (const node of diagram.contents) {
    node.base.incomings = node.base.incomings.filter((c) => c !== conn);
  }
}

// ------------------------------------------------------------ bendpoints

/**
 * All relations in the diagram in a stable order (contents order, then each
 * node's incoming connections). The webview relies on this order to map a
 * clicked line back to its relation, so it must match the render iteration.
 */
export function allRelations(diagram: ErmDiagram): ErmRelation[] {
  const result: ErmRelation[] = [];
  for (const node of diagram.contents) {
    if (node.kind === 'table' || node.kind === 'view') {
      for (const conn of node.base.incomings) {
        if (conn.kind === 'relation') {
          result.push(conn);
        }
      }
    }
  }
  return result;
}

/** Insert an absolute bendpoint at position `index` along the relation's path. */
export function addBendpoint(relation: ErmRelation, index: number, x: number, y: number): void {
  const clamped = Math.max(0, Math.min(index, relation.bendpoints.length));
  relation.bendpoints.splice(clamped, 0, {
    relative: 'false',
    x: String(Math.round(x)),
    y: String(Math.round(y)),
  });
}

/** Move an existing bendpoint to absolute coordinates. */
export function moveBendpoint(relation: ErmRelation, index: number, x: number, y: number): void {
  const bp = relation.bendpoints[index];
  if (!bp) {
    return;
  }
  bp.relative = 'false';
  bp.x = String(Math.round(x));
  bp.y = String(Math.round(y));
}

/** Remove the bendpoint at `index`. */
export function removeBendpoint(relation: ErmRelation, index: number): void {
  if (index >= 0 && index < relation.bendpoints.length) {
    relation.bendpoints.splice(index, 1);
  }
}

// ------------------------------------------------------------ column groups

/** Create a new diagram-level reusable column group. */
export function addColumnGroup(diagram: ErmDiagram, name = 'GROUP'): ErmColumnGroup {
  const group: ErmColumnGroup = { groupName: name, columns: [] };
  diagram.columnGroups.push(group);
  return group;
}

/** Delete a group and detach it from every table/view that includes it. */
export function deleteColumnGroup(diagram: ErmDiagram, group: ErmColumnGroup): void {
  diagram.columnGroups = diagram.columnGroups.filter((g) => g !== group);
  for (const node of diagram.contents) {
    if (node.kind === 'table' || node.kind === 'view') {
      node.columns = node.columns.filter((i) => i.kind !== 'group' || i.group !== group);
    }
  }
}

/** Add a plain column to a group (its definition is shared by every table using the group). */
export function addColumnToGroup(group: ErmColumnGroup, physicalName: string, type: string): ErmColumn {
  const column = newColumn(physicalName, type);
  group.columns.push(column);
  return column;
}

/** Remove a column from a group. */
export function removeColumnFromGroup(group: ErmColumnGroup, column: ErmColumn): void {
  group.columns = group.columns.filter((c) => c !== column);
}

/** Whether a table/view includes the given group. */
export function tableHasGroup(table: ErmTable | ErmView, group: ErmColumnGroup): boolean {
  return table.columns.some((i) => i.kind === 'group' && i.group === group);
}

/** Attach or detach a group on a table/view. */
export function toggleTableGroup(table: ErmTable | ErmView, group: ErmColumnGroup): void {
  if (tableHasGroup(table, group)) {
    table.columns = table.columns.filter((i) => i.kind !== 'group' || i.group !== group);
  } else {
    table.columns.push({ kind: 'group', group });
  }
  if (table.kind === 'table') {
    autoSize(table);
  }
}

// ------------------------------------------------------------ SQL types

/** Common SqlType ids from ERMaster's SqlType.xls (curated). */
export const KNOWN_TYPE_IDS = [
  'bigint', 'bigserial', 'bit(n)', 'blob', 'boolean', 'bytea',
  'char(n)', 'character(n)', 'clob', 'date', 'datetime', 'decimal(p,s)',
  'double', 'double precision', 'float', 'inet', 'int(n)', 'integer',
  'interval', 'longblob', 'longtext', 'mediumint', 'mediumtext', 'money',
  'nchar(n)', 'numeric(p,s)', 'nvarchar(n)', 'real', 'serial', 'smallint',
  'text', 'time', 'timestamp', 'timestamptz', 'tinyint', 'uuid',
  'varchar(n)', 'varchar(max)', 'varbinary(n)', 'xmltype',
];

export interface ParsedType {
  typeId: string;
  length: string;
  decimal: string;
}

/** "varchar(255)" → { typeId: "varchar(n)", length: "255" }, etc. */
export function parseTypeInput(input: string): ParsedType {
  const trimmed = input.trim();
  const m = /^(.+?)\s*\(\s*(\d+)\s*(?:,\s*(\d+))?\s*\)$/.exec(trimmed);
  if (!m) {
    return { typeId: trimmed, length: 'null', decimal: 'null' };
  }
  const base = m[1].trim();
  const length = m[2];
  const decimal = m[3];
  if (decimal !== undefined) {
    for (const suffix of ['(p,s)', '(m,d)']) {
      if (KNOWN_TYPE_IDS.includes(base + suffix)) {
        return { typeId: base + suffix, length, decimal };
      }
    }
    return { typeId: `${base}(p,s)`, length, decimal };
  }
  for (const suffix of ['(n)', '(p)']) {
    if (KNOWN_TYPE_IDS.includes(base + suffix)) {
      return { typeId: base + suffix, length, decimal: 'null' };
    }
  }
  return { typeId: `${base}(n)`, length, decimal: 'null' };
}

/** Render a column's effective type for display/DDL: "varchar(n)"+255 → "varchar(255)". */
export function formatType(column: ErmColumn): string {
  const parent = column.referencedColumns[0] ?? null;
  const word = column.word ?? parent?.word ?? null;
  let typeId = word ? word.type : column.type;
  if (!typeId) {
    return '';
  }
  // FK columns referencing serial parents become plain integers (ERMaster rule)
  if (parent) {
    if (typeId === 'serial') {
      typeId = 'integer';
    } else if (typeId === 'bigserial') {
      typeId = 'bigint';
    }
  }
  const length = word && /^\d+$/.test(word.length) ? word.length : null;
  const decimal = word && /^\d+$/.test(word.decimal) ? word.decimal : null;
  return typeId
    .replace(/\(n\)|\(p\)/, length !== null ? `(${length})` : '')
    .replace(/\(p,s\)|\(m,d\)/, length !== null ? `(${length}${decimal !== null ? ',' + decimal : ''})` : '');
}

/** Update a column's type from user input like "numeric(10,2)". */
export function setColumnType(column: ErmColumn, input: string): void {
  const parsed = parseTypeInput(input);
  column.type = parsed.typeId;
  if (column.word) {
    column.word.type = parsed.typeId;
    column.word.length = parsed.length;
    column.word.decimal = parsed.decimal;
  } else {
    column.word = newWord(column.physicalName, input);
  }
}

/** Effective display name of a column (like NormalColumn.getPhysicalName()). */
export function columnName(column: ErmColumn): string {
  const parent = column.referencedColumns[0] ?? null;
  if (parent) {
    return column.physicalName || columnName(parent);
  }
  return column.word?.physicalName || column.physicalName || '';
}

export function setColumnName(column: ErmColumn, physicalName: string): void {
  const parent = column.referencedColumns[0] ?? null;
  if (parent) {
    // FK column: the name is an override kept on the column itself
    column.physicalName = physicalName === columnName(parent) ? '' : physicalName;
    return;
  }
  if (column.word) {
    column.word.physicalName = physicalName;
    if (!column.word.logicalName) {
      column.word.logicalName = physicalName;
    }
  } else {
    column.word = newWord(physicalName, column.type);
  }
}
