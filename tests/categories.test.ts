import { describe, expect, it } from 'vitest';
import { addCategory, addTable, deleteCategory, deleteNode, emptyDiagram, toggleCategoryNode } from '../src/erm/ops';
import { categoryBounds } from '../src/webview/geometry';
import { loadErm } from '../src/erm/load';
import { writeErm } from '../src/erm/write';
import { isTable, ErmTable } from '../src/erm/model';

describe('categories', () => {
  it('creates, populates and round-trips', () => {
    const d = emptyDiagram();
    const a = addTable(d, 0, 0);
    a.physicalName = 'a';
    const b = addTable(d, 300, 0);
    b.physicalName = 'b';
    const cat = addCategory(d, 'Core');
    toggleCategoryNode(cat, a);
    toggleCategoryNode(cat, b);
    expect(cat.contents).toHaveLength(2);

    const xml = writeErm(d);
    expect(writeErm(loadErm(xml))).toBe(xml);

    const loaded = loadErm(xml);
    expect(loaded.settings.categories).toHaveLength(1);
    const lcat = loaded.settings.categories[0];
    expect(lcat.name).toBe('Core');
    expect(lcat.contents).toHaveLength(2);
    expect(lcat.contents.every((n) => isTable(n))).toBe(true);
  });

  it('toggles membership off', () => {
    const d = emptyDiagram();
    const a = addTable(d, 0, 0);
    const cat = addCategory(d);
    toggleCategoryNode(cat, a);
    expect(cat.contents).toHaveLength(1);
    toggleCategoryNode(cat, a);
    expect(cat.contents).toHaveLength(0);
  });

  it('deleting a table drops it from its category', () => {
    const d = emptyDiagram();
    const a = addTable(d, 0, 0);
    const b = addTable(d, 300, 0);
    const cat = addCategory(d);
    toggleCategoryNode(cat, a);
    toggleCategoryNode(cat, b);
    deleteNode(d, a);
    expect(cat.contents).toHaveLength(1);
    expect(cat.contents[0]).toBe(b);
  });

  it('deleteCategory removes it but keeps tables', () => {
    const d = emptyDiagram();
    const a = addTable(d, 0, 0);
    const cat = addCategory(d);
    toggleCategoryNode(cat, a);
    deleteCategory(d, cat);
    expect(d.settings.categories).toHaveLength(0);
    expect(d.contents).toContain(a);
  });

  it('computes a frame enclosing member tables', () => {
    const d = emptyDiagram();
    const a = addTable(d, 100, 100);
    const b = addTable(d, 400, 250);
    const cat = addCategory(d);
    expect(categoryBounds(cat, 'physical')).toBeNull(); // empty
    toggleCategoryNode(cat, a);
    toggleCategoryNode(cat, b);
    const bounds = categoryBounds(cat, 'physical')!;
    expect(bounds).not.toBeNull();
    expect(bounds.x).toBeLessThan(100);
    expect(bounds.y).toBeLessThan(100);
    expect(bounds.x + bounds.w).toBeGreaterThan(400);
    expect(bounds.y + bounds.h).toBeGreaterThan(250);
  });
});
