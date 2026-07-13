import { describe, expect, it } from 'vitest';
import { loadErm } from '../src/erm/load';
import { writeErm } from '../src/erm/write';
import { ErmTable, expandedColumns, isTable } from '../src/erm/model';
import { addTable, deleteTable, emptyDiagram } from '../src/erm/ops';
import { buildShop } from './helpers';

describe('erm round-trip', () => {
  it('empty diagram is write/load stable', () => {
    const xml = writeErm(emptyDiagram());
    expect(writeErm(loadErm(xml))).toBe(xml);
  });

  it('shop schema is write/load stable', () => {
    const xml = writeErm(buildShop());
    expect(writeErm(loadErm(xml))).toBe(xml);
  });

  it('resolves FK references after reload', () => {
    const loaded = loadErm(writeErm(buildShop()));
    const items = loaded.contents.find(
      (n) => isTable(n) && n.physicalName === 'order_items',
    ) as ErmTable;
    const fks = expandedColumns(items).filter((c) => c.referencedColumns.length > 0);
    expect(fks).toHaveLength(2);
    expect(items.base.incomings).toHaveLength(2);
  });

  it('word dictionary is sorted and deduplicated', () => {
    const xml = writeErm(buildShop());
    const words = [...xml.matchAll(/<word>[\s\S]*?<physical_name>(.*?)<\/physical_name>/g)].map(
      (m) => m[1],
    );
    const sorted = [...words].sort((a, b) => a.toUpperCase() < b.toUpperCase() ? -1 : 1);
    expect(words).toEqual(sorted);
  });

  it('deleting a parent table releases FK columns with their names', () => {
    const d = loadErm(writeErm(buildShop()));
    const products = d.contents.find((n) => isTable(n) && n.physicalName === 'products') as ErmTable;
    deleteTable(d, products);
    const reloaded = loadErm(writeErm(d));
    const items = reloaded.contents.find(
      (n) => isTable(n) && n.physicalName === 'order_items',
    ) as ErmTable;
    const released = expandedColumns(items).find((c) => c.word?.physicalName === 'product_id');
    expect(released).toBeDefined();
    expect(released!.referencedColumns).toHaveLength(0);
    expect(expandedColumns(items).filter((c) => c.referencedColumns.length > 0)).toHaveLength(1);
  });

  it('keeps the historical <inidex> typo', () => {
    const d = buildShop();
    const users = d.contents.find((n) => isTable(n) && n.physicalName === 'users') as ErmTable;
    users.indexes.push({
      fullText: 'false',
      nonUnique: 'true',
      name: 'idx_email',
      type: '',
      description: '',
      columns: [{ column: expandedColumns(users)[1], desc: 'false' }],
    });
    const xml = writeErm(d);
    expect(xml).toContain('<inidex>');
    expect(writeErm(loadErm(xml))).toBe(xml);
  });

  it('preserves raw sections verbatim through edits', () => {
    const original = writeErm(buildShop());
    expect(original).toContain('<sequence_set>');
    const xml = original.replace(
      /<sequence_set>/,
      '<sequence_set>\n\t<sequence>\n\t\t<name>seq_custom</name>\n\t\t<schema></schema>\n\t\t<increment>5</increment>\n\t\t<min_value></min_value>\n\t\t<max_value></max_value>\n\t\t<start>100</start>\n\t\t<cache></cache>\n\t\t<nocache>false</nocache>\n\t\t<cycle>false</cycle>\n\t\t<order>false</order>\n\t\t<description></description>\n\t\t<data_type></data_type>\n\t\t<decimal_size>0</decimal_size>\n\t</sequence>',
    );
    const d = loadErm(xml);
    addTable(d, 700, 60); // edit something unrelated
    const out = writeErm(d);
    expect(out).toContain('<name>seq_custom</name>');
    expect(out).toContain('<start>100</start>');
  });
});
