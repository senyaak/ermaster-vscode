// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { app } from '../src/webview/state';
import { sceneMarkup } from '../src/webview/render';
import { addCategory, addNote, addTable, emptyDiagram, toggleCategoryNode } from '../src/erm/ops';

describe('scene paint order (z-index)', () => {
  it('renders notes before tables so tables paint on top', () => {
    const d = emptyDiagram();
    // note created first, table second
    addNote(d, 100, 100, 'behind me');
    const t = addTable(d, 120, 120);
    t.physicalName = 'users';
    app.doc = d;

    const svg = sceneMarkup('physical');
    const noteAt = svg.indexOf('note-body');
    const tableAt = svg.indexOf('tbl-body');
    expect(noteAt).toBeGreaterThanOrEqual(0);
    expect(tableAt).toBeGreaterThanOrEqual(0);
    // earlier in the string = earlier in the DOM = painted first (behind)
    expect(noteAt).toBeLessThan(tableAt);
  });

  it('keeps notes behind even when the note is added AFTER the table', () => {
    const d = emptyDiagram();
    const t = addTable(d, 0, 0);
    t.physicalName = 'users';
    addNote(d, 10, 10, 'still behind'); // added last, must still render first
    app.doc = d;

    const svg = sceneMarkup('physical');
    expect(svg.indexOf('note-body')).toBeLessThan(svg.indexOf('tbl-body'));
  });

  it('category frames render before notes and tables', () => {
    const d = emptyDiagram();
    const t = addTable(d, 0, 0);
    t.physicalName = 'a';
    addNote(d, 5, 5, 'n');
    const cat = addCategory(d, 'grp');
    toggleCategoryNode(cat, t);
    app.doc = d;

    const svg = sceneMarkup('physical');
    const catAt = svg.indexOf('cat-rect');
    expect(catAt).toBeGreaterThanOrEqual(0);
    expect(catAt).toBeLessThan(svg.indexOf('note-body'));
    expect(catAt).toBeLessThan(svg.indexOf('tbl-body'));
  });
});
