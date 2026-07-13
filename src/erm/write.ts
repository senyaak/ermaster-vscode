import {
  ErmCategory,
  ErmColumn,
  ErmColumnGroup,
  ErmComplexUniqueKey,
  ErmConnection,
  ErmDiagram,
  ErmImage,
  ErmIndex,
  ErmNode,
  ErmNodeBase,
  ErmNote,
  ErmRelation,
  ErmTable,
  ErmTestData,
  ErmView,
  ErmWord,
  Rgb,
} from './model';
import { escapeXml as esc, indent as tab, XmlElement } from './xml';

/**
 * Serialize the model to .erm XML, replicating ERMaster's PersistentXmlImpl
 * byte-for-byte for everything we model (including its indentation quirks
 * and the historical <inidex> typo). Raw subtrees are re-emitted with
 * equivalent formatting.
 */
export function writeErm(diagram: ErmDiagram): string {
  const ctx = new WriteContext(diagram);

  let xml = '';
  xml += '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<diagram>\n';

  if (diagram.dbsetting) {
    xml += '\t<dbsetting>\n' + tab(tab(rawInner(diagram.dbsetting))) + '\t</dbsetting>\n';
  }
  if (diagram.pageSetting) {
    xml += '\t<page_setting>\n' + tab(tab(rawInner(diagram.pageSetting))) + '\t</page_setting>\n';
  }

  xml += `\t<category_index>${diagram.categoryIndex}</category_index>\n`;
  xml += `\t<zoom>${diagram.zoom}</zoom>\n`;
  xml += `\t<x>${diagram.x}</x>\n`;
  xml += `\t<y>${diagram.y}</y>\n`;
  xml += '\t<default_color>\n';
  xml += `\t\t<r>${diagram.defaultColor.r}</r>\n`;
  xml += `\t\t<g>${diagram.defaultColor.g}</g>\n`;
  xml += `\t\t<b>${diagram.defaultColor.b}</b>\n`;
  xml += '\t</default_color>\n';
  xml += tab(colorXml(diagram.color));
  xml += `\t<font_name>${esc(diagram.fontName)}</font_name>\n`;
  xml += `\t<font_size>${diagram.fontSize}</font_size>\n`;

  xml += tab(diagramContentsXml(diagram, ctx));
  xml += tab(changeTrackingListXml(diagram));

  xml += '</diagram>\n';
  return xml;
}

// ------------------------------------------------------------ id numbering
// Replicates PersistentXmlImpl.getContext(): the numbering must match the
// iteration order exactly, since all cross-references use these ids.

class WriteContext {
  groupIds = new Map<ErmColumnGroup, number>();
  columnIds = new Map<ErmColumn, number>();
  connectionIds = new Map<ErmConnection, number>();
  nodeIds = new Map<ErmNode | ErmCategory, number>();
  cukIds = new Map<ErmComplexUniqueKey, number>();
  wordIds = new Map<ErmWord, number>();
  sortedWords: ErmWord[];

  constructor(diagram: ErmDiagram) {
    let columnCount = 0;
    diagram.columnGroups.forEach((group, i) => {
      this.groupIds.set(group, i);
      for (const col of group.columns) {
        this.columnIds.set(col, columnCount++);
      }
    });

    let nodeCount = 0;
    let connectionCount = 0;
    let cukCount = 0;
    for (const node of diagram.contents) {
      this.nodeIds.set(node, nodeCount++);
      for (const conn of node.base.incomings) {
        this.connectionIds.set(conn, connectionCount++);
      }
      if (node.kind === 'table') {
        for (const item of node.columns) {
          if (item.kind === 'column') {
            this.columnIds.set(item.column, columnCount++);
          }
        }
        for (const cuk of node.complexUniqueKeys) {
          this.cukIds.set(cuk, cukCount++);
        }
      }
    }
    for (const category of diagram.settings.categories) {
      this.nodeIds.set(category, nodeCount++);
    }

    this.sortedWords = collectWords(diagram);
    this.sortedWords.forEach((w, i) => this.wordIds.set(w, i));
  }

  columnId(col: ErmColumn | null): string {
    if (!col) {
      return 'null';
    }
    const id = this.columnIds.get(col);
    return id === undefined ? 'null' : String(id);
  }

  nodeId(node: ErmNode | ErmCategory | null): string {
    if (!node) {
      return 'null';
    }
    const id = this.nodeIds.get(node);
    return id === undefined ? 'null' : String(id);
  }
}

/** Rebuild the dictionary from all non-FK columns, sorted like ERMaster's Dictionary. */
function collectWords(diagram: ErmDiagram): ErmWord[] {
  const words = new Set<ErmWord>();
  const addFrom = (columns: ErmColumn[]) => {
    for (const col of columns) {
      if (col.word && col.referencedColumns.length === 0) {
        words.add(col.word);
      }
    }
  };
  for (const group of diagram.columnGroups) {
    addFrom(group.columns);
  }
  for (const node of diagram.contents) {
    if (node.kind === 'table' || node.kind === 'view') {
      addFrom(
        node.columns.filter((i) => i.kind === 'column').map((i) => (i as { kind: 'column'; column: ErmColumn }).column),
      );
    }
  }
  return [...words].sort(compareWords);
}

function compareWords(a: ErmWord, b: ErmWord): number {
  const cmp = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0);
  let v = cmp(a.physicalName.toUpperCase(), b.physicalName.toUpperCase());
  if (v !== 0) {
    return v;
  }
  v = cmp(a.logicalName.toUpperCase(), b.logicalName.toUpperCase());
  if (v !== 0) {
    return v;
  }
  v = cmp(a.type, b.type);
  if (v !== 0) {
    return v;
  }
  const numCmp = (x: string, y: string) => {
    const xn = /^\d+$/.test(x) ? parseInt(x, 10) : null;
    const yn = /^\d+$/.test(y) ? parseInt(y, 10) : null;
    if (xn === null) {
      return yn === null ? 0 : 1;
    }
    return yn === null ? -1 : xn - yn;
  };
  v = numCmp(a.length, b.length);
  if (v !== 0) {
    return v;
  }
  v = numCmp(a.decimal, b.decimal);
  if (v !== 0) {
    return v;
  }
  return cmp(a.description, b.description);
}

// ------------------------------------------------------------ raw passthrough

/** Serialize the children of a raw element in ERMaster's block style. */
function rawInner(el: XmlElement): string {
  let out = '';
  for (const c of el.children) {
    out += rawElement(c);
  }
  return out;
}

function rawElement(el: XmlElement): string {
  if (el.children.length === 0) {
    return `<${el.tag}>${esc(el.text)}</${el.tag}>\n`;
  }
  return `<${el.tag}>\n` + tab(rawInner(el)) + `</${el.tag}>\n`;
}

/** Emits `<tag>` block with raw children, or nothing if el is null. */
function rawBlock(el: XmlElement | null): string {
  if (!el) {
    return '';
  }
  return rawElement(el);
}

// ------------------------------------------------------------ shared pieces

function colorXml(color: Rgb | null): string {
  if (!color) {
    return '';
  }
  return `<color>\n\t<r>${color.r}</r>\n\t<g>${color.g}</g>\n\t<b>${color.b}</b>\n</color>\n`;
}

function nodeElementXml(node: ErmNode | ErmCategory, base: ErmNodeBase, ctx: WriteContext): string {
  let xml = '';
  xml += `<id>${ctx.nodeId(node)}</id>\n`;
  xml += `<height>${base.height}</height>\n`;
  xml += `<width>${base.width}</width>\n`;
  // ERMaster indents these two one level deeper — keep it that way
  xml += `\t<font_name>${esc(base.fontName)}</font_name>\n`;
  xml += `\t<font_size>${base.fontSize}</font_size>\n`;
  xml += `<x>${base.x}</x>\n`;
  xml += `<y>${base.y}</y>\n`;
  xml += colorXml(base.color);
  xml += connectionsXml(base.incomings, ctx);
  return xml;
}

function connectionsXml(incomings: ErmConnection[], ctx: WriteContext): string {
  let xml = '<connections>\n';
  for (const conn of incomings) {
    if (conn.kind === 'comment') {
      xml += tab('<comment_connection>\n' + tab(connectionElementXml(conn, ctx)) + '</comment_connection>\n');
    } else {
      xml += tab(relationXml(conn, ctx));
    }
  }
  xml += '</connections>\n';
  return xml;
}

function connectionElementXml(conn: ErmConnection, ctx: WriteContext): string {
  let xml = '';
  xml += `<id>${ctx.connectionIds.get(conn) ?? 'null'}</id>\n`;
  xml += `<source>${ctx.nodeId(conn.source)}</source>\n`;
  xml += `<target>${ctx.nodeId(conn.target)}</target>\n`;
  xml += `\t<source_xp>${conn.sourceXp}</source_xp>\n`;
  xml += `\t<source_yp>${conn.sourceYp}</source_yp>\n`;
  xml += `\t<target_xp>${conn.targetXp}</target_xp>\n`;
  xml += `\t<target_yp>${conn.targetYp}</target_yp>\n`;
  for (const bp of conn.bendpoints) {
    xml += tab(`<bendpoint>\n\t<relative>${bp.relative}</relative>\n\t<x>${bp.x}</x>\n\t<y>${bp.y}</y>\n</bendpoint>\n`);
  }
  xml += tab(colorXml(conn.color));
  return xml;
}

function relationXml(rel: ErmRelation, ctx: WriteContext): string {
  let xml = '<relation>\n';
  xml += tab(connectionElementXml(rel, ctx));
  xml += `\t<child_cardinality>${esc(rel.childCardinality)}</child_cardinality>\n`;
  xml += `\t<parent_cardinality>${esc(rel.parentCardinality)}</parent_cardinality>\n`;
  xml += `\t<reference_for_pk>${rel.referenceForPk}</reference_for_pk>\n`;
  xml += `\t<name>${esc(rel.name)}</name>\n`;
  xml += `\t<on_delete_action>${esc(rel.onDeleteAction)}</on_delete_action>\n`;
  xml += `\t<on_update_action>${esc(rel.onUpdateAction)}</on_update_action>\n`;
  xml += `\t<referenced_column>${ctx.columnId(rel.referencedColumn)}</referenced_column>\n`;
  const cukId = rel.referencedComplexUniqueKey
    ? ctx.cukIds.get(rel.referencedComplexUniqueKey) ?? 'null'
    : 'null';
  xml += `\t<referenced_complex_unique_key>${cukId}</referenced_complex_unique_key>\n`;
  xml += '</relation>\n';
  return xml;
}

// ------------------------------------------------------------ columns

function columnsXml(items: (ErmTable | ErmView)['columns'], ctx: WriteContext): string {
  let xml = '<columns>\n';
  for (const item of items) {
    if (item.kind === 'group') {
      xml += tab(`<column_group>${ctx.groupIds.get(item.group) ?? 'null'}</column_group>\n`);
    } else {
      xml += tab(normalColumnXml(item.column, ctx));
    }
  }
  xml += '</columns>\n';
  return xml;
}

const DEFAULT_SEQUENCE_XML =
  '<sequence>\n\t<name></name>\n\t<schema></schema>\n\t<increment></increment>\n\t<min_value></min_value>\n\t<max_value></max_value>\n\t<start></start>\n\t<cache></cache>\n\t<nocache>false</nocache>\n\t<cycle>false</cycle>\n\t<order>false</order>\n\t<description></description>\n\t<data_type></data_type>\n\t<decimal_size>0</decimal_size>\n</sequence>\n';

function normalColumnXml(col: ErmColumn, ctx: WriteContext): string {
  let xml = '<normal_column>\n';
  if (col.word) {
    const wordId = ctx.wordIds.get(col.word);
    if (wordId !== undefined) {
      xml += `\t<word_id>${wordId}</word_id>\n`;
    }
  }
  xml += `\t<id>${ctx.columnId(col)}</id>\n`;
  for (const ref of col.referencedColumns) {
    const id = ctx.columnIds.get(ref);
    xml += `\t<referenced_column>${id === undefined ? '' : id}</referenced_column>\n`;
  }
  for (const rel of col.relations) {
    xml += `\t<relation>${ctx.connectionIds.get(rel) ?? 'null'}</relation>\n`;
  }
  xml += `\t<description>${esc(col.description)}</description>\n`;
  xml += `\t<unique_key_name>${esc(col.uniqueKeyName)}</unique_key_name>\n`;
  xml += `\t<logical_name>${esc(col.logicalName)}</logical_name>\n`;
  xml += `\t<physical_name>${esc(col.physicalName)}</physical_name>\n`;
  xml += `\t<type>${col.type}</type>\n`;
  xml += `\t<constraint>${esc(col.constraint)}</constraint>\n`;
  xml += `\t<default_value>${esc(col.defaultValue)}</default_value>\n`;
  xml += `\t<auto_increment>${col.autoIncrement}</auto_increment>\n`;
  xml += `\t<foreign_key>${col.foreignKey}</foreign_key>\n`;
  xml += `\t<not_null>${col.notNull}</not_null>\n`;
  xml += `\t<primary_key>${col.primaryKey}</primary_key>\n`;
  xml += `\t<unique_key>${col.uniqueKey}</unique_key>\n`;
  xml += `\t<character_set>${esc(col.characterSet)}</character_set>\n`;
  xml += `\t<collation>${esc(col.collation)}</collation>\n`;
  xml += tab(col.sequence ? rawElement(col.sequence) : DEFAULT_SEQUENCE_XML);
  xml += '</normal_column>\n';
  return xml;
}

// ------------------------------------------------------------ node elements

function tableXml(table: ErmTable, ctx: WriteContext): string {
  let xml = '<table>\n';
  xml += tab(nodeElementXml(table, table.base, ctx));
  xml += `\t<physical_name>${esc(table.physicalName)}</physical_name>\n`;
  xml += `\t<logical_name>${esc(table.logicalName)}</logical_name>\n`;
  xml += `\t<description>${esc(table.description)}</description>\n`;
  xml += `\t<constraint>${esc(table.constraint)}</constraint>\n`;
  xml += `\t<primary_key_name>${esc(table.primaryKeyName)}</primary_key_name>\n`;
  xml += `\t<option>${esc(table.option)}</option>\n`;
  xml += tab(columnsXml(table.columns, ctx));
  xml += tab(indexesXml(table.indexes, ctx));
  xml += tab(cukListXml(table.complexUniqueKeys, ctx));
  xml += tab(table.tableProperties ? rawElement(table.tableProperties) : '<table_properties>\n\t<schema></schema>\n</table_properties>\n');
  xml += '</table>\n';
  return xml;
}

function viewXml(view: ErmView, ctx: WriteContext): string {
  let xml = '<view>\n';
  xml += tab(nodeElementXml(view, view.base, ctx));
  xml += `\t<physical_name>${esc(view.physicalName)}</physical_name>\n`;
  xml += `\t<logical_name>${esc(view.logicalName)}</logical_name>\n`;
  xml += `\t<description>${esc(view.description)}</description>\n`;
  xml += `\t<sql>${esc(view.sql)}</sql>\n`;
  xml += tab(columnsXml(view.columns, ctx));
  xml += tab(view.viewProperties ? rawElement(view.viewProperties) : '<view_properties>\n<schema></schema>\n</view_properties>\n');
  xml += '</view>\n';
  return xml;
}

function noteXml(note: ErmNote, ctx: WriteContext): string {
  let xml = '<note>\n';
  xml += tab(nodeElementXml(note, note.base, ctx));
  xml += `\t<text>${esc(note.text)}</text>\n`;
  xml += '</note>\n';
  return xml;
}

function imageXml(image: ErmImage, ctx: WriteContext): string {
  let xml = '<image>\n';
  xml += tab(nodeElementXml(image, image.base, ctx));
  xml += `\t<data>${image.data}</data>\n`;
  xml += `\t<hue>${image.hue}</hue>\n`;
  xml += `\t<saturation>${image.saturation}</saturation>\n`;
  xml += `\t<brightness>${image.brightness}</brightness>\n`;
  xml += `\t<alpha>${image.alpha}</alpha>\n`;
  xml += `\t<fix_aspect_ratio>${image.fixAspectRatio}</fix_aspect_ratio>\n`;
  xml += '</image>\n';
  return xml;
}

function indexesXml(indexes: ErmIndex[], ctx: WriteContext): string {
  let xml = '<indexes>\n';
  for (const index of indexes) {
    // yes, <inidex> — ERMaster's typo is part of the format
    let block = '<inidex>\n';
    block += `\t<full_text>${index.fullText}</full_text>\n`;
    block += `\t<non_unique>${index.nonUnique}</non_unique>\n`;
    block += `\t<name>${esc(index.name)}</name>\n`;
    block += `\t<type>${esc(index.type)}</type>\n`;
    block += `\t<description>${esc(index.description)}</description>\n`;
    block += '\t<columns>\n';
    for (const c of index.columns) {
      block += `\t\t<column>\n\t\t\t<id>${ctx.columnId(c.column)}</id>\n\t\t\t<desc>${c.desc}</desc>\n\t\t</column>\n`;
    }
    block += '\t</columns>\n';
    block += '</inidex>\n';
    xml += tab(block);
  }
  xml += '</indexes>\n';
  return xml;
}

function cukListXml(cuks: ErmComplexUniqueKey[], ctx: WriteContext): string {
  let xml = '<complex_unique_key_list>\n';
  for (const cuk of cuks) {
    let block = '<complex_unique_key>\n';
    block += `\t<id>${ctx.cukIds.get(cuk) ?? 'null'}</id>\n`;
    block += `\t<name>${esc(cuk.name)}</name>\n`;
    block += '\t<columns>\n';
    for (const col of cuk.columns) {
      block += `\t\t<column>\n\t\t\t<id>${ctx.columnId(col)}</id>\n\t\t</column>\n`;
    }
    block += '\t</columns>\n';
    block += '</complex_unique_key>\n';
    xml += tab(block);
  }
  xml += '</complex_unique_key_list>\n';
  return xml;
}

// ------------------------------------------------------------ contents/dictionary/etc

function diagramContentsXml(diagram: ErmDiagram, ctx: WriteContext): string {
  let xml = '';
  xml += settingsXml(diagram, ctx);
  xml += dictionaryXml(ctx);
  xml += setXml('tablespace_set', diagram.tablespaces);
  xml += contentsXml(diagram, ctx);
  xml += columnGroupsXml(diagram, ctx);
  xml += testDataListXml(diagram.testDataList, ctx);
  xml += setXml('sequence_set', diagram.sequences);
  xml += setXml('trigger_set', diagram.triggers);
  return xml;
}

function contentsXml(diagram: ErmDiagram, ctx: WriteContext): string {
  let xml = '<contents>\n';
  for (const node of diagram.contents) {
    switch (node.kind) {
      case 'table':
        xml += tab(tableXml(node, ctx));
        break;
      case 'view':
        xml += tab(viewXml(node, ctx));
        break;
      case 'note':
        xml += tab(noteXml(node, ctx));
        break;
      case 'image':
        xml += tab(imageXml(node, ctx));
        break;
    }
  }
  xml += '</contents>\n';
  return xml;
}

function dictionaryXml(ctx: WriteContext): string {
  let xml = '<dictionary>\n';
  for (const word of ctx.sortedWords) {
    let block = '<word>\n';
    block += `\t<id>${ctx.wordIds.get(word)}</id>\n`;
    block += `\t<length>${word.length}</length>\n`;
    block += `\t<decimal>${word.decimal}</decimal>\n`;
    block += `\t<array>${word.array}</array>\n`;
    block += `\t<array_dimension>${word.arrayDimension}</array_dimension>\n`;
    block += `\t<unsigned>${word.unsigned}</unsigned>\n`;
    block += `\t<zerofill>${word.zerofill}</zerofill>\n`;
    block += `\t<binary>${word.binary}</binary>\n`;
    block += `\t<args>${esc(word.args)}</args>\n`;
    block += `\t<char_semantics>${word.charSemantics}</char_semantics>\n`;
    block += `\t<description>${esc(word.description)}</description>\n`;
    block += `\t<logical_name>${esc(word.logicalName)}</logical_name>\n`;
    block += `\t<physical_name>${esc(word.physicalName)}</physical_name>\n`;
    block += `\t<type>${word.type}</type>\n`;
    block += '</word>\n';
    xml += tab(block);
  }
  xml += '</dictionary>\n';
  return xml;
}

function columnGroupsXml(diagram: ErmDiagram, ctx: WriteContext): string {
  let xml = '<column_groups>\n';
  for (const group of diagram.columnGroups) {
    let block = '<column_group>\n';
    block += `\t<id>${ctx.groupIds.get(group)}</id>\n`;
    block += `\t<group_name>${esc(group.groupName)}</group_name>\n`;
    block += '\t<columns>\n';
    for (const col of group.columns) {
      block += tab(tab(normalColumnXml(col, ctx)));
    }
    block += '\t</columns>\n';
    block += '</column_group>\n';
    xml += tab(tab(block));
  }
  xml += '</column_groups>\n';
  return xml;
}

function setXml(tag: string, elements: XmlElement[]): string {
  let xml = `<${tag}>\n`;
  for (const el of elements) {
    xml += tab(rawElement(el));
  }
  xml += `</${tag}>\n`;
  return xml;
}

function changeTrackingListXml(diagram: ErmDiagram): string {
  let xml = '<change_tracking_list>\n';
  for (const el of diagram.changeTrackings) {
    xml += tab(rawElement(el));
  }
  xml += '</change_tracking_list>\n';
  return xml;
}

// ------------------------------------------------------------ test data

function testDataListXml(list: ErmTestData[], ctx: WriteContext): string {
  let xml = '<test_data_list>\n';
  for (const testData of list) {
    let block = '<test_data>\n';
    block += `\t<name>${esc(testData.name)}</name>\n`;
    block += `\t<export_order>${testData.exportOrder}</export_order>\n`;
    for (const t of testData.tables) {
      if (!t.table || !ctx.nodeIds.has(t.table)) {
        continue; // table was deleted — drop its test data like ERMaster would
      }
      let tblock = '<table_test_data>\n';
      tblock += `\t<table_id>${ctx.nodeId(t.table)}</table_id>\n`;

      let direct = '<direct_test_data>\n';
      for (const row of t.directRows) {
        direct += '\t<data>\n';
        for (const cd of row) {
          if (!cd.column || !ctx.columnIds.has(cd.column)) {
            continue;
          }
          direct += `\t\t<column_data>\n\t\t\t<column_id>${ctx.columnId(cd.column)}</column_id>\n\t\t\t<value>${esc(cd.value)}</value>\n\t\t</column_data>\n`;
        }
        direct += '\t</data>\n';
      }
      direct += '</direct_test_data>\n';
      tblock += tab(direct);

      let repeat = '<repeat_test_data>\n';
      repeat += `\t<test_data_num>${t.repeatTestDataNum}</test_data_num>\n`;
      repeat += '\t<data_def_list>\n';
      for (const def of t.repeatDefs) {
        if (!def.column || !ctx.columnIds.has(def.column)) {
          continue;
        }
        let dblock = '<data_def>\n';
        dblock += `\t<column_id>${ctx.columnId(def.column)}</column_id>\n`;
        dblock += `\t<type>${esc(def.type)}</type>\n`;
        dblock += `\t<repeat_num>${def.repeatNum}</repeat_num>\n`;
        dblock += `\t<template>${esc(def.template)}</template>\n`;
        dblock += `\t<from>${def.from}</from>\n`;
        dblock += `\t<to>${def.to}</to>\n`;
        dblock += `\t<increment>${def.increment}</increment>\n`;
        for (const sel of def.selects) {
          dblock += `\t<select>${esc(sel)}</select>\n`;
        }
        dblock += '\t<modified_values>\n';
        for (const mv of def.modifiedValues) {
          dblock += `\t\t<modified_value>\n\t\t\t<row>${mv.row}</row>\n\t\t\t<value>${esc(mv.value)}</value>\n\t\t</modified_value>\n`;
        }
        dblock += '\t</modified_values>\n';
        dblock += '</data_def>\n';
        repeat += tab(tab(dblock));
      }
      repeat += '\t</data_def_list>\n';
      repeat += '</repeat_test_data>\n';
      tblock += tab(repeat);

      tblock += '</table_test_data>\n';
      block += tab(tblock);
    }
    block += '</test_data>\n';
    xml += tab(tab(block));
  }
  xml += '</test_data_list>\n';
  return xml;
}

// ------------------------------------------------------------ settings

function settingsXml(diagram: ErmDiagram, ctx: WriteContext): string {
  const s = diagram.settings;
  let xml = '<settings>\n';
  xml += `\t<database>${esc(s.database)}</database>\n`;
  xml += `\t<capital>${s.capital}</capital>\n`;
  xml += `\t<table_style>${esc(s.tableStyle)}</table_style>\n`;
  xml += `\t<notation>${esc(s.notation)}</notation>\n`;
  xml += `\t<notation_level>${s.notationLevel}</notation_level>\n`;
  xml += `\t<notation_expand_group>${s.notationExpandGroup}</notation_expand_group>\n`;
  xml += `\t<view_mode>${s.viewMode}</view_mode>\n`;
  xml += `\t<outline_view_mode>${s.outlineViewMode}</outline_view_mode>\n`;
  xml += `\t<view_order_by>${s.viewOrderBy}</view_order_by>\n`;
  xml += `\t<auto_ime_change>${s.autoImeChange}</auto_ime_change>\n`;
  xml += `\t<validate_physical_name>${s.validatePhysicalName}</validate_physical_name>\n`;
  xml += `\t<use_bezier_curve>${s.useBezierCurve}</use_bezier_curve>\n`;
  xml += `\t<suspend_validator>${s.suspendValidator}</suspend_validator>\n`;
  xml += tab(exportSettingXml(diagram, ctx));
  xml += tab(categorySettingsXml(diagram, ctx));
  xml += tab(s.translationSettings ? rawElement(s.translationSettings) : '<translation_settings>\n\t<use>false</use>\n\t<translations></translations>\n</translation_settings>\n');
  xml += tab(s.modelProperties ? rawElement(s.modelProperties) : defaultModelPropertiesXml());
  xml += tab(s.tableProperties ? rawElement(s.tableProperties) : '<table_properties>\n\t<schema></schema>\n</table_properties>\n');
  xml += tab(environmentSettingXml(diagram));
  xml += '</settings>\n';
  return xml;
}

function defaultModelPropertiesXml(): string {
  // generic raw-block formatting (matches what rawElement re-emits on reload)
  return (
    '<model_properties>\n' +
    '\t<id></id>\n\t<height>-1</height>\n\t<width>-1</width>\n\t<font_name></font_name>\n\t<font_size>9</font_size>\n\t<x>50</x>\n\t<y>50</y>\n' +
    '\t<color>\n\t\t<r>255</r>\n\t\t<g>255</g>\n\t\t<b>255</b>\n\t</color>\n' +
    '\t<connections></connections>\n' +
    '\t<display>false</display>\n' +
    '\t<creation_date>2000-01-01 00:00:00</creation_date>\n' +
    '\t<updated_date>2000-01-01 00:00:00</updated_date>\n' +
    '</model_properties>\n'
  );
}

function exportSettingXml(diagram: ErmDiagram, ctx: WriteContext): string {
  const s = diagram.settings;
  let xml = '<export_setting>\n';

  const ddl = s.exportDdl;
  let ddlBlock = '<export_ddl_setting>\n';
  ddlBlock += `\t<output_path>${esc(ddl?.outputPath ?? '')}</output_path>\n`;
  ddlBlock += `\t<encoding>${esc(ddl?.encoding ?? '')}</encoding>\n`;
  ddlBlock += `\t<line_feed>${esc(ddl?.lineFeed ?? '')}</line_feed>\n`;
  ddlBlock += `\t<is_open_after_saved>${ddl?.openAfterSaved ?? 'true'}</is_open_after_saved>\n`;
  ddlBlock += `\t<environment_id>${ddl?.environmentId ?? '0'}</environment_id>\n`;
  ddlBlock += `\t<category_id>${ctx.nodeId(ddl?.category ?? null)}</category_id>\n`;
  ddlBlock += tab(ddl?.ddlTarget ? rawElement(ddl.ddlTarget) : defaultDdlTargetXml());
  ddlBlock += '</export_ddl_setting>\n';
  xml += tab(ddlBlock);

  const excel = s.exportExcel;
  let excelBlock = '<export_excel_setting>\n';
  excelBlock += `\t<category_id>${ctx.nodeId(excel?.category ?? null)}</category_id>\n`;
  excelBlock += `\t<output_path>${esc(excel?.outputPath ?? '')}</output_path>\n`;
  excelBlock += `\t<template>${esc(excel?.template ?? '')}</template>\n`;
  excelBlock += `\t<template_path>${esc(excel?.templatePath ?? '')}</template_path>\n`;
  excelBlock += `\t<used_default_template_lang>${esc(excel?.usedDefaultTemplateLang ?? '')}</used_default_template_lang>\n`;
  excelBlock += `\t<image_output>${esc(excel?.imageOutput ?? '')}</image_output>\n`;
  excelBlock += `\t<is_open_after_saved>${excel?.openAfterSaved ?? 'true'}</is_open_after_saved>\n`;
  excelBlock += `\t<is_put_diagram>${excel?.putDiagram ?? 'true'}</is_put_diagram>\n`;
  excelBlock += `\t<is_use_logical_name>${excel?.useLogicalName ?? 'true'}</is_use_logical_name>\n`;
  excelBlock += '</export_excel_setting>\n';
  xml += tab(excelBlock);

  xml += tab(s.exportHtml ? rawElement(s.exportHtml) : '<export_html_setting>\n\t<output_dir></output_dir>\n\t<with_category_image>true</with_category_image>\n\t<with_image>true</with_image>\n\t<is_open_after_saved>false</is_open_after_saved>\n</export_html_setting>\n');
  xml += tab(s.exportImage ? rawElement(s.exportImage) : '<export_image_setting>\n\t<output_file_path></output_file_path>\n\t<category_dir_path></category_dir_path>\n\t<with_category_image>true</with_category_image>\n\t<is_open_after_saved>false</is_open_after_saved>\n</export_image_setting>\n');
  xml += tab(s.exportJava ? rawElement(s.exportJava) : '<export_java_setting>\n\t<java_output></java_output>\n\t<package_name></package_name>\n\t<class_name_suffix></class_name_suffix>\n\t<src_file_encoding></src_file_encoding>\n\t<with_hibernate>false</with_hibernate>\n</export_java_setting>\n');
  xml += tab(s.exportTestData ? rawElement(s.exportTestData) : '<export_testdata_setting>\n\t<file_encoding></file_encoding>\n\t<file_path></file_path>\n\t<format>0</format>\n</export_testdata_setting>\n');

  xml += '</export_setting>\n';
  return xml;
}

function defaultDdlTargetXml(): string {
  return (
    '<ddl_target>\n' +
    '\t<create_comment>true</create_comment>\n' +
    '\t<create_foreignKey>true</create_foreignKey>\n' +
    '\t<create_index>true</create_index>\n' +
    '\t<create_sequence>true</create_sequence>\n' +
    '\t<create_table>true</create_table>\n' +
    '\t<create_tablespace>true</create_tablespace>\n' +
    '\t<create_trigger>true</create_trigger>\n' +
    '\t<create_view>true</create_view>\n' +
    '\t<drop_index>true</drop_index>\n' +
    '\t<drop_sequence>true</drop_sequence>\n' +
    '\t<drop_table>true</drop_table>\n' +
    '\t<drop_tablespace>true</drop_tablespace>\n' +
    '\t<drop_trigger>true</drop_trigger>\n' +
    '\t<drop_view>true</drop_view>\n' +
    '\t<inline_column_comment>true</inline_column_comment>\n' +
    '\t<inline_table_comment>true</inline_table_comment>\n' +
    '\t<comment_value_description>true</comment_value_description>\n' +
    '\t<comment_value_logical_name>false</comment_value_logical_name>\n' +
    '\t<comment_value_logical_name_description>false</comment_value_logical_name_description>\n' +
    '\t<comment_replace_line_feed>false</comment_replace_line_feed>\n' +
    '\t<comment_replace_string></comment_replace_string>\n' +
    '</ddl_target>\n'
  );
}

function categorySettingsXml(diagram: ErmDiagram, ctx: WriteContext): string {
  const s = diagram.settings;
  let xml = '<category_settings>\n';
  xml += `\t<free_layout>${s.categoryFreeLayout}</free_layout>\n`;
  xml += `\t<show_referred_tables>${s.categoryShowReferredTables}</show_referred_tables>\n`;
  xml += '\t<categories>\n';
  for (const category of s.categories) {
    let block = '<category>\n';
    block += tab(nodeElementXml(category, category.base, ctx));
    block += `\t<name>${esc(category.name)}</name>\n`;
    block += `\t<selected>${category.selected}</selected>\n`;
    for (const node of category.contents) {
      if (ctx.nodeIds.has(node)) {
        block += `\t<node_element>${ctx.nodeId(node)}</node_element>\n`;
      }
    }
    block += '</category>\n';
    xml += tab(tab(block));
  }
  xml += '\t</categories>\n';
  xml += '</category_settings>\n';
  return xml;
}

function environmentSettingXml(diagram: ErmDiagram): string {
  let xml = '<environment_setting>\n';
  diagram.settings.environments.forEach((env, i) => {
    xml += `\t<environment>\n\t\t<id>${i}</id>\n\t\t<name>${env.name}</name>\n\t</environment>\n`;
  });
  xml += '</environment_setting>\n';
  return xml;
}
