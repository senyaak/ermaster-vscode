import { XmlElement } from './xml';

/**
 * In-memory model of an ERMaster .erm diagram.
 *
 * Values of type `Raw` hold the exact (unescaped) text found in the file and
 * are re-emitted verbatim, so anything we don't actively edit survives a
 * round-trip. Cross-references (numeric ids in the file) are resolved to
 * object references at load time and renumbered at save time exactly the way
 * ERMaster's PersistentXmlImpl does.
 *
 * Subtrees we never touch are kept as raw XmlElements and re-serialized.
 */
export type Raw = string;

export interface Rgb {
  r: Raw;
  g: Raw;
  b: Raw;
}

// ------------------------------------------------------------ connections

export interface ErmConnectionBase {
  source: ErmNode | null;
  target: ErmNode | null;
  sourceXp: Raw;
  sourceYp: Raw;
  targetXp: Raw;
  targetYp: Raw;
  bendpoints: { relative: Raw; x: Raw; y: Raw }[];
  color: Rgb | null;
}

export interface ErmRelation extends ErmConnectionBase {
  kind: 'relation';
  childCardinality: Raw;
  parentCardinality: Raw;
  referenceForPk: Raw;
  name: Raw;
  onDeleteAction: Raw;
  onUpdateAction: Raw;
  referencedColumn: ErmColumn | null;
  referencedComplexUniqueKey: ErmComplexUniqueKey | null;
}

export interface ErmCommentConnection extends ErmConnectionBase {
  kind: 'comment';
}

export type ErmConnection = ErmRelation | ErmCommentConnection;

// ------------------------------------------------------------ dictionary

export interface ErmWord {
  length: Raw;
  decimal: Raw;
  array: Raw;
  arrayDimension: Raw;
  unsigned: Raw;
  zerofill: Raw;
  binary: Raw;
  args: Raw;
  charSemantics: Raw;
  description: Raw;
  logicalName: Raw;
  physicalName: Raw;
  type: Raw;
}

// ------------------------------------------------------------ columns

export interface ErmColumn {
  word: ErmWord | null;
  /** relations this FK column participates in (resolved) */
  relations: ErmRelation[];
  /** parent columns this FK column references (resolved) */
  referencedColumns: ErmColumn[];
  description: Raw;
  uniqueKeyName: Raw;
  logicalName: Raw;
  physicalName: Raw;
  type: Raw;
  constraint: Raw;
  defaultValue: Raw;
  autoIncrement: Raw;
  foreignKey: Raw;
  notNull: Raw;
  primaryKey: Raw;
  uniqueKey: Raw;
  characterSet: Raw;
  collation: Raw;
  /** auto-increment <sequence> settings, raw */
  sequence: XmlElement | null;
}

export interface ErmColumnGroup {
  groupName: Raw;
  columns: ErmColumn[];
}

export type ErmColumnItem =
  | { kind: 'column'; column: ErmColumn }
  | { kind: 'group'; group: ErmColumnGroup };

// ------------------------------------------------------------ node elements

export interface ErmNodeBase {
  height: Raw;
  width: Raw;
  fontName: Raw;
  fontSize: Raw;
  x: Raw;
  y: Raw;
  color: Rgb | null;
  /** connections whose target is this node */
  incomings: ErmConnection[];
}

export interface ErmIndex {
  fullText: Raw;
  nonUnique: Raw;
  name: Raw;
  type: Raw;
  description: Raw;
  columns: { column: ErmColumn | null; desc: Raw }[];
}

export interface ErmComplexUniqueKey {
  name: Raw;
  columns: (ErmColumn | null)[];
}

export interface ErmTable {
  kind: 'table';
  base: ErmNodeBase;
  physicalName: Raw;
  logicalName: Raw;
  description: Raw;
  constraint: Raw;
  primaryKeyName: Raw;
  option: Raw;
  columns: ErmColumnItem[];
  indexes: ErmIndex[];
  complexUniqueKeys: ErmComplexUniqueKey[];
  /** raw <table_properties> subtree (tablespace/environment refs are stable for us) */
  tableProperties: XmlElement | null;
}

export interface ErmView {
  kind: 'view';
  base: ErmNodeBase;
  physicalName: Raw;
  logicalName: Raw;
  description: Raw;
  sql: Raw;
  columns: ErmColumnItem[];
  viewProperties: XmlElement | null;
}

export interface ErmNote {
  kind: 'note';
  base: ErmNodeBase;
  text: Raw;
}

export interface ErmImage {
  kind: 'image';
  base: ErmNodeBase;
  data: Raw;
  hue: Raw;
  saturation: Raw;
  brightness: Raw;
  alpha: Raw;
  fixAspectRatio: Raw;
}

export type ErmNode = ErmTable | ErmView | ErmNote | ErmImage;

// ------------------------------------------------------------ settings

export interface ErmCategory {
  base: ErmNodeBase;
  name: Raw;
  selected: Raw;
  contents: ErmNode[];
}

export interface ErmExportDdlSetting {
  outputPath: Raw;
  encoding: Raw;
  lineFeed: Raw;
  openAfterSaved: Raw;
  environmentId: Raw;
  category: ErmCategory | null;
  ddlTarget: XmlElement | null;
}

export interface ErmExportExcelSetting {
  category: ErmCategory | null;
  outputPath: Raw;
  template: Raw;
  templatePath: Raw;
  usedDefaultTemplateLang: Raw;
  imageOutput: Raw;
  openAfterSaved: Raw;
  putDiagram: Raw;
  useLogicalName: Raw;
}

export interface ErmSettings {
  database: Raw;
  capital: Raw;
  tableStyle: Raw;
  notation: Raw;
  notationLevel: Raw;
  notationExpandGroup: Raw;
  viewMode: Raw;
  outlineViewMode: Raw;
  viewOrderBy: Raw;
  autoImeChange: Raw;
  validatePhysicalName: Raw;
  useBezierCurve: Raw;
  suspendValidator: Raw;
  exportDdl: ErmExportDdlSetting | null;
  exportExcel: ErmExportExcelSetting | null;
  exportHtml: XmlElement | null;
  exportImage: XmlElement | null;
  exportJava: XmlElement | null;
  exportTestData: XmlElement | null;
  categoryFreeLayout: Raw;
  categoryShowReferredTables: Raw;
  categories: ErmCategory[];
  translationSettings: XmlElement | null;
  modelProperties: XmlElement | null;
  tableProperties: XmlElement | null;
  environments: { name: Raw }[];
}

// ------------------------------------------------------------ test data

export interface ErmTestDataColumnValue {
  column: ErmColumn | null;
  value: Raw;
}

export interface ErmRepeatDataDef {
  column: ErmColumn | null;
  type: Raw;
  repeatNum: Raw;
  template: Raw;
  from: Raw;
  to: Raw;
  increment: Raw;
  selects: Raw[];
  modifiedValues: { row: Raw; value: Raw }[];
}

export interface ErmTableTestData {
  table: ErmTable | null;
  directRows: ErmTestDataColumnValue[][];
  repeatTestDataNum: Raw;
  repeatDefs: ErmRepeatDataDef[];
}

export interface ErmTestData {
  name: Raw;
  exportOrder: Raw;
  tables: ErmTableTestData[];
}

// ------------------------------------------------------------ diagram

export interface ErmDiagram {
  dbsetting: XmlElement | null;
  pageSetting: XmlElement | null;
  categoryIndex: Raw;
  zoom: Raw;
  x: Raw;
  y: Raw;
  defaultColor: Rgb;
  color: Rgb | null;
  fontName: Raw;
  fontSize: Raw;
  settings: ErmSettings;
  /** dictionary as loaded; sorted ERMaster-style at save time */
  words: ErmWord[];
  /** raw <tablespace> subtrees (never edited here, ids inside stay stable) */
  tablespaces: XmlElement[];
  contents: ErmNode[];
  columnGroups: ErmColumnGroup[];
  testDataList: ErmTestData[];
  sequences: XmlElement[];
  triggers: XmlElement[];
  changeTrackings: XmlElement[];
}

export function isTable(n: ErmNode): n is ErmTable {
  return n.kind === 'table';
}

/** All NormalColumns of a table/view including expanded column groups. */
export function expandedColumns(t: ErmTable | ErmView): ErmColumn[] {
  const out: ErmColumn[] = [];
  for (const item of t.columns) {
    if (item.kind === 'column') {
      out.push(item.column);
    } else {
      out.push(...item.group.columns);
    }
  }
  return out;
}

/** The relation a FK column belongs to, if any. */
export function isForeignKey(c: ErmColumn): boolean {
  return c.referencedColumns.length > 0;
}
