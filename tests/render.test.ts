// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { app } from '../src/webview/state';
import { sceneMarkup } from '../src/webview/render';
import { addCategory, addColumn, addNote, addTable, createRelationAutoFk, emptyDiagram, toggleCategoryNode } from '../src/erm/ops';

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

describe('relation routing (chopbox anchors)', () => {
  it('draws a straight horizontal line between vertically-aligned tables', () => {
    const d = emptyDiagram();
    const parent = addTable(d, 0, 0);
    parent.physicalName = 'parent';
    const child = addTable(d, 400, 0);
    child.physicalName = 'child';
    createRelationAutoFk(parent, child);
    // the child gains the FK column, so add one to the parent to keep heights equal
    addColumn(parent, 'name', 'varchar(255)');
    app.doc = d;

    const svg = sceneMarkup('physical');
    const m = /class="rel-line[^"]*" d="M ([\d.-]+) ([\d.-]+) L ([\d.-]+) ([\d.-]+)"/.exec(svg);
    expect(m).toBeTruthy();
    const [sx, sy, tx, ty] = m!.slice(1).map(Number);
    // endpoints on the facing edges: parent (left) exits its right side toward child
    expect(sx).toBeLessThan(tx);
    // both tables share a baseline, so the connection is horizontal
    expect(sy).toBe(ty);
    // and the source anchor sits on the parent's right edge (x > 0, well left of child)
    expect(sx).toBeGreaterThan(0);
    expect(tx).toBeGreaterThanOrEqual(400);
  });
});
