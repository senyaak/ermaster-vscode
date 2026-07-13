import {
  ErmCategory,
  ErmColumn,
  ErmColumnGroup,
  ErmColumnItem,
  ErmComplexUniqueKey,
  ErmConnection,
  ErmDiagram,
  ErmImage,
  ErmIndex,
  ErmNode,
  ErmNodeBase,
  ErmNote,
  ErmRelation,
  ErmSettings,
  ErmTable,
  ErmTestData,
  ErmView,
  ErmWord,
  Rgb,
} from './model';
import { child, childrenOf, parseXml, str, XmlElement } from './xml';

/**
 * Load a .erm XML document into the model. Mirrors ERMaster's XMLLoader:
 * ids are collected into maps first and resolved to object references at
 * the end, so forward references work regardless of element order.
 */
export function loadErm(xmlText: string): ErmDiagram {
  const root = parseXml(xmlText);
  if (root.tag !== 'diagram') {
    throw new Error(`not an ERMaster file: root element <${root.tag}>`);
  }

  const ctx = new LoadContext();

  const settingsEl = child(root, 'settings');

  const diagram: ErmDiagram = {
    dbsetting: child(root, 'dbsetting'),
    pageSetting: child(root, 'page_setting'),
    categoryIndex: str(root, 'category_index') ?? '0',
    zoom: str(root, 'zoom') ?? '1.0',
    x: str(root, 'x') ?? '0',
    y: str(root, 'y') ?? '0',
    defaultColor: loadRgb(child(root, 'default_color')) ?? { r: '128', g: '128', b: '192' },
    color: loadRgb(child(root, 'color')),
    fontName: str(root, 'font_name') ?? '',
    fontSize: str(root, 'font_size') ?? '9',
    settings: emptySettings(),
    words: loadDictionary(root, ctx),
    tablespaces: childrenOf(child(root, 'tablespace_set'), 'tablespace'),
    contents: [],
    columnGroups: loadColumnGroups(root, ctx),
    testDataList: [],
    sequences: childrenOf(child(root, 'sequence_set'), 'sequence'),
    triggers: childrenOf(child(root, 'trigger_set'), 'trigger'),
    changeTrackings: childrenOf(child(root, 'change_tracking_list'), 'change_tracking'),
  };

  diagram.contents = loadContents(root, ctx);
  diagram.settings = loadSettings(settingsEl, ctx);
  diagram.testDataList = loadTestDataList(root, ctx);

  ctx.resolve();

  return diagram;
}

class LoadContext {
  nodeMap = new Map<string, ErmNode | ErmCategory>();
  columnMap = new Map<string, ErmColumn>();
  cukMap = new Map<string, ErmComplexUniqueKey>();
  connectionMap = new Map<string, ErmConnection>();
  wordMap = new Map<string, ErmWord>();
  groupMap = new Map<string, ErmColumnGroup>();

  // deferred references
  connectionSource = new Map<ErmConnection, string>();
  connectionTarget = new Map<ErmConnection, string>();
  relationReferencedColumn = new Map<ErmRelation, string>();
  relationReferencedCuk = new Map<ErmRelation, string>();
  columnRelationIds = new Map<ErmColumn, string[]>();
  columnReferencedIds = new Map<ErmColumn, string[]>();
  indexColumnRefs: { holder: { column: ErmColumn | null }; id: string }[] = [];
  cukColumnRefs: { cuk: ErmComplexUniqueKey; index: number; id: string }[] = [];
  categoryContentRefs: { category: ErmCategory; ids: string[] }[] = [];
  testColumnRefs: { holder: { column: ErmColumn | null }; id: string }[] = [];
  testTableRefs: { holder: { table: ErmTable | null }; id: string }[] = [];

  resolve(): void {
    for (const [conn, id] of this.connectionSource) {
      const node = this.nodeMap.get(id);
      conn.source = node && 'kind' in node ? (node as ErmNode) : null;
    }
    for (const [conn, id] of this.connectionTarget) {
      const node = this.nodeMap.get(id);
      conn.target = node && 'kind' in node ? (node as ErmNode) : null;
    }
    for (const [rel, id] of this.relationReferencedColumn) {
      rel.referencedColumn = this.columnMap.get(id) ?? null;
    }
    for (const [rel, id] of this.relationReferencedCuk) {
      rel.referencedComplexUniqueKey = this.cukMap.get(id) ?? null;
    }
    for (const [col, ids] of this.columnReferencedIds) {
      col.referencedColumns = ids
        .filter((id) => /^\d+$/.test(id))
        .map((id) => this.columnMap.get(id))
        .filter((c): c is ErmColumn => !!c);
    }
    for (const [col, ids] of this.columnRelationIds) {
      col.relations = ids
        .filter((id) => /^\d+$/.test(id))
        .map((id) => this.connectionMap.get(id))
        .filter((c): c is ErmRelation => !!c && c.kind === 'relation');
    }
    for (const ref of this.indexColumnRefs) {
      ref.holder.column = this.columnMap.get(ref.id) ?? null;
    }
    for (const ref of this.cukColumnRefs) {
      ref.cuk.columns[ref.index] = this.columnMap.get(ref.id) ?? null;
    }
    for (const ref of this.categoryContentRefs) {
      ref.category.contents = ref.ids
        .map((id) => this.nodeMap.get(id))
        .filter((n): n is ErmNode => !!n && 'kind' in n);
    }
    for (const ref of this.testColumnRefs) {
      ref.holder.column = this.columnMap.get(ref.id) ?? null;
    }
    for (const ref of this.testTableRefs) {
      const node = this.nodeMap.get(ref.id);
      ref.holder.table = node && 'kind' in node && node.kind === 'table' ? node : null;
    }
  }
}

function loadRgb(el: XmlElement | null): Rgb | null {
  if (!el) {
    return null;
  }
  return {
    r: str(el, 'r') ?? '0',
    g: str(el, 'g') ?? '0',
    b: str(el, 'b') ?? '0',
  };
}

// ------------------------------------------------------------ dictionary

function loadDictionary(root: XmlElement, ctx: LoadContext): ErmWord[] {
  const words: ErmWord[] = [];
  for (const wordEl of childrenOf(child(root, 'dictionary'), 'word')) {
    const word: ErmWord = {
      length: str(wordEl, 'length') ?? 'null',
      decimal: str(wordEl, 'decimal') ?? 'null',
      array: str(wordEl, 'array') ?? 'false',
      arrayDimension: str(wordEl, 'array_dimension') ?? 'null',
      unsigned: str(wordEl, 'unsigned') ?? 'false',
      zerofill: str(wordEl, 'zerofill') ?? 'false',
      binary: str(wordEl, 'binary') ?? 'false',
      args: str(wordEl, 'args') ?? '',
      charSemantics: str(wordEl, 'char_semantics') ?? 'false',
      description: str(wordEl, 'description') ?? '',
      logicalName: str(wordEl, 'logical_name') ?? '',
      physicalName: str(wordEl, 'physical_name') ?? '',
      type: str(wordEl, 'type') ?? '',
    };
    words.push(word);
    const id = str(wordEl, 'id');
    if (id !== null) {
      ctx.wordMap.set(id, word);
    }
  }
  return words;
}

// ------------------------------------------------------------ columns

function loadColumnItems(parent: XmlElement, ctx: LoadContext): ErmColumnItem[] {
  const items: ErmColumnItem[] = [];
  const columnsEl = child(parent, 'columns');
  if (!columnsEl) {
    return items;
  }
  for (const el of columnsEl.children) {
    if (el.tag === 'column_group') {
      const group = ctx.groupMap.get(el.text);
      if (group) {
        items.push({ kind: 'group', group });
      }
    } else if (el.tag === 'normal_column') {
      items.push({ kind: 'column', column: loadNormalColumn(el, ctx) });
    }
  }
  return items;
}

function loadNormalColumn(el: XmlElement, ctx: LoadContext): ErmColumn {
  const wordId = str(el, 'word_id');
  const column: ErmColumn = {
    word: wordId !== null ? ctx.wordMap.get(wordId) ?? null : null,
    relations: [],
    referencedColumns: [],
    description: str(el, 'description') ?? '',
    uniqueKeyName: str(el, 'unique_key_name') ?? '',
    logicalName: str(el, 'logical_name') ?? '',
    physicalName: str(el, 'physical_name') ?? '',
    type: str(el, 'type') ?? '',
    constraint: str(el, 'constraint') ?? '',
    defaultValue: str(el, 'default_value') ?? '',
    autoIncrement: str(el, 'auto_increment') ?? 'false',
    foreignKey: str(el, 'foreign_key') ?? 'false',
    notNull: str(el, 'not_null') ?? 'false',
    primaryKey: str(el, 'primary_key') ?? 'false',
    uniqueKey: str(el, 'unique_key') ?? 'false',
    characterSet: str(el, 'character_set') ?? '',
    collation: str(el, 'collation') ?? '',
    sequence: child(el, 'sequence'),
  };

  const relationIds = childrenOf(el, 'relation').map((e) => e.text);
  if (relationIds.length) {
    ctx.columnRelationIds.set(column, relationIds);
  }
  const referencedIds = childrenOf(el, 'referenced_column').map((e) => e.text);
  if (referencedIds.length) {
    ctx.columnReferencedIds.set(column, referencedIds);
  }

  const id = str(el, 'id');
  if (id !== null) {
    ctx.columnMap.set(id, column);
  }
  return column;
}

function loadColumnGroups(root: XmlElement, ctx: LoadContext): ErmColumnGroup[] {
  const groups: ErmColumnGroup[] = [];
  for (const groupEl of childrenOf(child(root, 'column_groups'), 'column_group')) {
    const group: ErmColumnGroup = {
      groupName: str(groupEl, 'group_name') ?? '',
      columns: loadColumnItems(groupEl, ctx)
        .filter((i): i is { kind: 'column'; column: ErmColumn } => i.kind === 'column')
        .map((i) => i.column),
    };
    groups.push(group);
    const id = str(groupEl, 'id');
    if (id !== null) {
      ctx.groupMap.set(id, group);
    }
  }
  return groups;
}

// ------------------------------------------------------------ node elements

function loadNodeBase(el: XmlElement, node: ErmNode | ErmCategory, ctx: LoadContext): ErmNodeBase {
  const base: ErmNodeBase = {
    height: str(el, 'height') ?? '0',
    width: str(el, 'width') ?? '0',
    fontName: str(el, 'font_name') ?? '',
    fontSize: str(el, 'font_size') ?? '9',
    x: str(el, 'x') ?? '0',
    y: str(el, 'y') ?? '0',
    color: loadRgb(child(el, 'color')),
    incomings: [],
  };
  const id = str(el, 'id');
  if (id !== null) {
    ctx.nodeMap.set(id, node);
  }
  base.incomings = loadConnections(el, ctx);
  return base;
}

function loadConnections(parent: XmlElement, ctx: LoadContext): ErmConnection[] {
  const out: ErmConnection[] = [];
  const connectionsEl = child(parent, 'connections');
  if (!connectionsEl) {
    return out;
  }
  for (const el of connectionsEl.children) {
    if (el.tag === 'relation') {
      const rel: ErmRelation = {
        kind: 'relation',
        ...loadConnectionBase(el, ctx),
        childCardinality: str(el, 'child_cardinality') ?? '',
        parentCardinality: str(el, 'parent_cardinality') ?? '',
        referenceForPk: str(el, 'reference_for_pk') ?? 'false',
        name: str(el, 'name') ?? '',
        onDeleteAction: str(el, 'on_delete_action') ?? '',
        onUpdateAction: str(el, 'on_update_action') ?? '',
        referencedColumn: null,
        referencedComplexUniqueKey: null,
      };
      registerConnection(el, rel, ctx);
      const refCol = str(el, 'referenced_column');
      if (refCol !== null && refCol !== 'null') {
        ctx.relationReferencedColumn.set(rel, refCol);
      }
      const refCuk = str(el, 'referenced_complex_unique_key');
      if (refCuk !== null && refCuk !== 'null') {
        ctx.relationReferencedCuk.set(rel, refCuk);
      }
      out.push(rel);
    } else if (el.tag === 'comment_connection') {
      const conn: ErmConnection = { kind: 'comment', ...loadConnectionBase(el, ctx) };
      registerConnection(el, conn, ctx);
      out.push(conn);
    }
  }
  return out;
}

function loadConnectionBase(el: XmlElement, ctx: LoadContext) {
  return {
    source: null,
    target: null,
    sourceXp: str(el, 'source_xp') ?? '-1',
    sourceYp: str(el, 'source_yp') ?? '-1',
    targetXp: str(el, 'target_xp') ?? '-1',
    targetYp: str(el, 'target_yp') ?? '-1',
    bendpoints: childrenOf(el, 'bendpoint').map((b) => ({
      relative: str(b, 'relative') ?? 'false',
      x: str(b, 'x') ?? '0',
      y: str(b, 'y') ?? '0',
    })),
    color: loadRgb(child(el, 'color')),
  };
}

function registerConnection(el: XmlElement, conn: ErmConnection, ctx: LoadContext): void {
  const id = str(el, 'id');
  if (id !== null) {
    ctx.connectionMap.set(id, conn);
  }
  const source = str(el, 'source');
  if (source !== null) {
    ctx.connectionSource.set(conn, source);
  }
  const target = str(el, 'target');
  if (target !== null) {
    ctx.connectionTarget.set(conn, target);
  }
}

function loadContents(root: XmlElement, ctx: LoadContext): ErmNode[] {
  const out: ErmNode[] = [];
  const contentsEl = child(root, 'contents');
  if (!contentsEl) {
    return out;
  }
  for (const el of contentsEl.children) {
    switch (el.tag) {
      case 'table':
        out.push(loadTable(el, ctx));
        break;
      case 'view':
        out.push(loadView(el, ctx));
        break;
      case 'note':
        out.push(loadNote(el, ctx));
        break;
      case 'image':
        out.push(loadImage(el, ctx));
        break;
    }
  }
  return out;
}

function loadTable(el: XmlElement, ctx: LoadContext): ErmTable {
  const table: ErmTable = {
    kind: 'table',
    base: null as unknown as ErmNodeBase,
    physicalName: str(el, 'physical_name') ?? '',
    logicalName: str(el, 'logical_name') ?? '',
    description: str(el, 'description') ?? '',
    constraint: str(el, 'constraint') ?? '',
    primaryKeyName: str(el, 'primary_key_name') ?? '',
    option: str(el, 'option') ?? '',
    columns: [],
    indexes: [],
    complexUniqueKeys: [],
    tableProperties: child(el, 'table_properties'),
  };
  table.base = loadNodeBase(el, table, ctx);
  table.columns = loadColumnItems(el, ctx);
  table.indexes = loadIndexes(el, ctx);
  table.complexUniqueKeys = loadComplexUniqueKeys(el, ctx);
  return table;
}

function loadView(el: XmlElement, ctx: LoadContext): ErmView {
  const view: ErmView = {
    kind: 'view',
    base: null as unknown as ErmNodeBase,
    physicalName: str(el, 'physical_name') ?? '',
    logicalName: str(el, 'logical_name') ?? '',
    description: str(el, 'description') ?? '',
    sql: str(el, 'sql') ?? '',
    columns: [],
    viewProperties: child(el, 'view_properties'),
  };
  view.base = loadNodeBase(el, view, ctx);
  view.columns = loadColumnItems(el, ctx);
  return view;
}

function loadNote(el: XmlElement, ctx: LoadContext): ErmNote {
  const note: ErmNote = {
    kind: 'note',
    base: null as unknown as ErmNodeBase,
    text: str(el, 'text') ?? '',
  };
  note.base = loadNodeBase(el, note, ctx);
  return note;
}

function loadImage(el: XmlElement, ctx: LoadContext): ErmImage {
  const image: ErmImage = {
    kind: 'image',
    base: null as unknown as ErmNodeBase,
    data: str(el, 'data') ?? '',
    hue: str(el, 'hue') ?? '0',
    saturation: str(el, 'saturation') ?? '0',
    brightness: str(el, 'brightness') ?? '0',
    alpha: str(el, 'alpha') ?? '255',
    fixAspectRatio: str(el, 'fix_aspect_ratio') ?? 'true',
  };
  image.base = loadNodeBase(el, image, ctx);
  return image;
}

function loadIndexes(parent: XmlElement, ctx: LoadContext): ErmIndex[] {
  const out: ErmIndex[] = [];
  const indexesEl = child(parent, 'indexes');
  if (!indexesEl) {
    return out;
  }
  // note ERMaster's historical typo: indexes are serialized as <inidex>
  for (const el of indexesEl.children) {
    if (el.tag !== 'inidex' && el.tag !== 'index') {
      continue;
    }
    const index: ErmIndex = {
      fullText: str(el, 'full_text') ?? 'false',
      nonUnique: str(el, 'non_unique') ?? 'true',
      name: str(el, 'name') ?? '',
      type: str(el, 'type') ?? '',
      description: str(el, 'description') ?? '',
      columns: [],
    };
    for (const colEl of childrenOf(child(el, 'columns'), 'column')) {
      const entry = { column: null as ErmColumn | null, desc: str(colEl, 'desc') ?? 'false' };
      index.columns.push(entry);
      const id = str(colEl, 'id');
      if (id !== null) {
        ctx.indexColumnRefs.push({ holder: entry, id });
      }
    }
    out.push(index);
  }
  return out;
}

function loadComplexUniqueKeys(parent: XmlElement, ctx: LoadContext): ErmComplexUniqueKey[] {
  const out: ErmComplexUniqueKey[] = [];
  const listEl = child(parent, 'complex_unique_key_list');
  if (!listEl) {
    return out;
  }
  for (const el of childrenOf(listEl, 'complex_unique_key')) {
    const cuk: ErmComplexUniqueKey = {
      name: str(el, 'name') ?? '',
      columns: [],
    };
    const colEls = childrenOf(child(el, 'columns'), 'column');
    colEls.forEach((colEl, i) => {
      cuk.columns.push(null);
      const id = str(colEl, 'id');
      if (id !== null) {
        ctx.cukColumnRefs.push({ cuk, index: i, id });
      }
    });
    out.push(cuk);
    const id = str(el, 'id');
    if (id !== null) {
      ctx.cukMap.set(id, cuk);
    }
  }
  return out;
}

// ------------------------------------------------------------ settings

function emptySettings(): ErmSettings {
  return {
    database: 'PostgreSQL',
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
    environments: [],
  };
}

function loadSettings(el: XmlElement | null, ctx: LoadContext): ErmSettings {
  const s = emptySettings();
  if (!el) {
    return s;
  }
  s.database = str(el, 'database') ?? s.database;
  s.capital = str(el, 'capital') ?? s.capital;
  s.tableStyle = str(el, 'table_style') ?? '';
  s.notation = str(el, 'notation') ?? '';
  s.notationLevel = str(el, 'notation_level') ?? '0';
  s.notationExpandGroup = str(el, 'notation_expand_group') ?? 'false';
  s.viewMode = str(el, 'view_mode') ?? '1';
  s.outlineViewMode = str(el, 'outline_view_mode') ?? '1';
  s.viewOrderBy = str(el, 'view_order_by') ?? '1';
  s.autoImeChange = str(el, 'auto_ime_change') ?? 'false';
  s.validatePhysicalName = str(el, 'validate_physical_name') ?? 'true';
  s.useBezierCurve = str(el, 'use_bezier_curve') ?? 'false';
  s.suspendValidator = str(el, 'suspend_validator') ?? 'false';

  // categories (before export settings, which reference them)
  const catSettingsEl = child(el, 'category_settings');
  if (catSettingsEl) {
    s.categoryFreeLayout = str(catSettingsEl, 'free_layout') ?? 'false';
    s.categoryShowReferredTables = str(catSettingsEl, 'show_referred_tables') ?? 'false';
    for (const catEl of childrenOf(child(catSettingsEl, 'categories'), 'category')) {
      const category: ErmCategory = {
        base: null as unknown as ErmNodeBase,
        name: str(catEl, 'name') ?? '',
        selected: str(catEl, 'selected') ?? 'false',
        contents: [],
      };
      category.base = loadNodeBase(catEl, category, ctx);
      const ids = childrenOf(catEl, 'node_element').map((e) => e.text);
      ctx.categoryContentRefs.push({ category, ids });
      s.categories.push(category);
    }
  }

  const catById = (id: string | null): ErmCategory | null => {
    if (id === null) {
      return null;
    }
    const node = ctx.nodeMap.get(id);
    return node && !('kind' in node) ? (node as ErmCategory) : null;
  };

  const exportEl = child(el, 'export_setting');
  if (exportEl) {
    const ddlEl = child(exportEl, 'export_ddl_setting');
    if (ddlEl) {
      s.exportDdl = {
        outputPath: str(ddlEl, 'output_path') ?? '',
        encoding: str(ddlEl, 'encoding') ?? '',
        lineFeed: str(ddlEl, 'line_feed') ?? '',
        openAfterSaved: str(ddlEl, 'is_open_after_saved') ?? 'true',
        environmentId: str(ddlEl, 'environment_id') ?? '',
        category: catById(str(ddlEl, 'category_id')),
        ddlTarget: child(ddlEl, 'ddl_target'),
      };
    }
    const excelEl = child(exportEl, 'export_excel_setting');
    if (excelEl) {
      s.exportExcel = {
        category: catById(str(excelEl, 'category_id')),
        outputPath: str(excelEl, 'output_path') ?? '',
        template: str(excelEl, 'template') ?? '',
        templatePath: str(excelEl, 'template_path') ?? '',
        usedDefaultTemplateLang: str(excelEl, 'used_default_template_lang') ?? '',
        imageOutput: str(excelEl, 'image_output') ?? '',
        openAfterSaved: str(excelEl, 'is_open_after_saved') ?? 'true',
        putDiagram: str(excelEl, 'is_put_diagram') ?? 'true',
        useLogicalName: str(excelEl, 'is_use_logical_name') ?? 'true',
      };
    }
    s.exportHtml = child(exportEl, 'export_html_setting');
    s.exportImage = child(exportEl, 'export_image_setting');
    s.exportJava = child(exportEl, 'export_java_setting');
    s.exportTestData = child(exportEl, 'export_testdata_setting');
  }

  s.translationSettings = child(el, 'translation_settings');
  s.modelProperties = child(el, 'model_properties');
  s.tableProperties = child(el, 'table_properties');

  const envEl = child(el, 'environment_setting');
  if (envEl) {
    for (const e of childrenOf(envEl, 'environment')) {
      s.environments.push({ name: str(e, 'name') ?? '' });
    }
  }
  if (s.environments.length === 0) {
    s.environments.push({ name: 'Default' });
  }

  return s;
}

// ------------------------------------------------------------ test data

function loadTestDataList(root: XmlElement, ctx: LoadContext): ErmTestData[] {
  const out: ErmTestData[] = [];
  for (const el of childrenOf(child(root, 'test_data_list'), 'test_data')) {
    const testData: ErmTestData = {
      name: str(el, 'name') ?? '',
      exportOrder: str(el, 'export_order') ?? '0',
      tables: [],
    };
    for (const tableEl of childrenOf(el, 'table_test_data')) {
      const tableTestData = {
        table: null as ErmTable | null,
        directRows: [] as { column: ErmColumn | null; value: string }[][],
        repeatTestDataNum: '0',
        repeatDefs: [] as ErmTestData['tables'][number]['repeatDefs'],
      };
      const tableId = str(tableEl, 'table_id');
      if (tableId !== null) {
        ctx.testTableRefs.push({ holder: tableTestData, id: tableId });
      }
      const directEl = child(tableEl, 'direct_test_data');
      for (const dataEl of childrenOf(directEl, 'data')) {
        const row: { column: ErmColumn | null; value: string }[] = [];
        for (const cd of childrenOf(dataEl, 'column_data')) {
          const entry = { column: null as ErmColumn | null, value: str(cd, 'value') ?? '' };
          const colId = str(cd, 'column_id');
          if (colId !== null) {
            ctx.testColumnRefs.push({ holder: entry, id: colId });
          }
          row.push(entry);
        }
        tableTestData.directRows.push(row);
      }
      const repeatEl = child(tableEl, 'repeat_test_data');
      if (repeatEl) {
        tableTestData.repeatTestDataNum = str(repeatEl, 'test_data_num') ?? '0';
        for (const defEl of childrenOf(child(repeatEl, 'data_def_list'), 'data_def')) {
          const def = {
            column: null as ErmColumn | null,
            type: str(defEl, 'type') ?? '',
            repeatNum: str(defEl, 'repeat_num') ?? '',
            template: str(defEl, 'template') ?? '',
            from: str(defEl, 'from') ?? '',
            to: str(defEl, 'to') ?? '',
            increment: str(defEl, 'increment') ?? '',
            selects: childrenOf(defEl, 'select').map((e) => e.text),
            modifiedValues: childrenOf(child(defEl, 'modified_values'), 'modified_value').map(
              (mv) => ({ row: str(mv, 'row') ?? '0', value: str(mv, 'value') ?? '' }),
            ),
          };
          const colId = str(defEl, 'column_id');
          if (colId !== null) {
            ctx.testColumnRefs.push({ holder: def, id: colId });
          }
          tableTestData.repeatDefs.push(def);
        }
      }
      testData.tables.push(tableTestData);
    }
    out.push(testData);
  }
  return out;
}
